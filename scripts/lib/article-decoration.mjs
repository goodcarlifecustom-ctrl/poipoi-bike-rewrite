import * as parse5 from "parse5";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DECORATION_ATTR = "data-poipoi-decoration";
const DEFAULT_CONFIG = {
  articleTocTitle: "この記事でわかること",
  sectionIndexes: [],
  contentLists: [],
  paragraph: { maxChars: 180, maxSentences: 4, targetSentencesPerParagraph: 2, shortParagraphChars: 18, shortParagraphRun: 4 },
  markers: { maxPerSection: 2, positiveKeywords: ["おすすめ", "高価買取", "無料", "メリット", "査定"], negativeKeywords: ["注意", "デメリット", "トラブル", "確認", "キャンセル"] },
};

export async function loadArticleDecorationConfig(configPath = "rules/article-decoration.json", articleDir = null) {
  const base = mergeConfig(DEFAULT_CONFIG, JSON.parse(await readFile(configPath, "utf8")));
  if (!articleDir) return base;
  try {
    return mergeConfig(base, JSON.parse(await readFile(join(articleDir, "article-decoration.json"), "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return base;
    throw error;
  }
}

export function decorateArticleHtml(html, config = {}) {
  const cfg = mergeConfig(DEFAULT_CONFIG, config);
  const document = parse5.parseFragment(stripHeadingBlockComments(String(html)), { sourceCodeLocationInfo: false });
  const report = emptyRunReport();
  const articleTocPlan = collectArticleTocPlan(document, cfg);
  unwrapExistingMarkers(document, report);
  removeGeneratedDecorations(document);
  removeExistingArticleTocs(document, cfg, report);
  assignHeadingIds(document, articleTocPlan);
  splitLongParagraphs(document, cfg, report);
  buildArticleToc(document, cfg, articleTocPlan);
  buildSectionIndexes(document, cfg, report);
  wrapConfiguredLists(document, cfg, report);
  applyMarkers(document, cfg, report);
  const output = serializeHeadingBlocks(parse5.serialize(document));
  const validation = validateDecorations(output, cfg);
  report.errors = validation.errors;
  Object.assign(report, validation.metrics);
  return { html: output, report };
}

export function validateDecorations(html, config = {}) {
  const cfg = mergeConfig(DEFAULT_CONFIG, config);
  const document = parse5.parseFragment(String(html));
  const errors = [];
  const h2s = headings(document, "h2");
  const allIds = elements(document).map((node) => attr(node, "id")).filter(Boolean);
  const h2Ids = h2s.map((node) => attr(node, "id")).filter(Boolean);
  if (new Set(h2Ids).size !== h2Ids.length) errors.push("H2 IDが重複しています");

  const toc = generatedBlocks(document, "article-toc");
  if (toc.length !== 1) errors.push(`記事目次が1個ではありません: ${toc.length}`);
  const tocLinks = toc[0] ? descendants(toc[0], (node) => tagName(node) === "a") : [];
  for (const link of tocLinks) {
    const href = attr(link, "href");
    if (!idExists(allIds, href)) errors.push(`記事目次のリンク先IDが存在しません: ${href}`);
    const target = h2s.find((h2) => attr(h2, "id") === href?.slice(1));
    if (!target) errors.push(`記事目次のリンク先がH2ではありません: ${href}`);
  }

  const h3IndexReports = [];
  for (const section of cfg.sectionIndexes || []) {
    const resolved = resolveSection(document, section);
    if (!resolved.h2) {
      if (section.required) errors.push(`対象H2が見つかりません: ${sectionLabel(section)}`);
      continue;
    }
    const key = sectionKey(section, resolved.index);
    const h3s = h3sInSection(document, resolved.h2);
    const block = generatedBlocks(document, `section-index-${key}`)[0];
    const links = block ? descendants(block, (node) => tagName(node) === "a") : [];
    h3IndexReports.push({ key, h2Id: attr(resolved.h2, "id"), h2Text: headingText(resolved.h2), h3Count: h3s.length, linkCount: links.length });
    if (h3s.length > 0 && !block) errors.push(`H3一覧がありません: ${sectionLabel(section)}`);
    if (block && links.length !== h3s.length) errors.push(`H3一覧リンク数とH3数が一致しません: ${sectionLabel(section)}`);
    for (const h3 of h3s) if (!attr(h3, "id")) errors.push(`IDがないH3があります: ${sectionLabel(section)}`);
    for (const link of links) if (!idExists(allIds, attr(link, "href"))) errors.push(`H3一覧のリンク先IDが存在しません: ${attr(link, "href")}`);
  }

  for (const item of cfg.contentLists || []) {
    const lists = elements(document).filter((node) => matchesSelector(node, item.selector));
    if (item.required && lists.length === 0) errors.push(`必須contentLists selectorが見つかりません: ${item.selector}`);
    for (const list of lists) {
      const box = closest(list, (node) => hasClass(node, "cap_box") || attr(node, DECORATION_ATTR) === "content-list");
      if (!box) errors.push(`対象リストがボックス外にあります: ${item.selector}`);
      else if (!textContent(box).includes(item.title)) errors.push(`対象リストのボックスタイトルが異なります: ${item.title}`);
    }
  }
  for (const box of elements(document).filter((node) => hasClass(node, "cap_box"))) {
    if (closest(parentOf(document, box), (node) => hasClass(node, "cap_box"))) errors.push("二重リストボックスがあります");
  }

  const paragraphs = targetParagraphs(document);
  for (const p of paragraphs) {
    const text = textContent(p).trim();
    const sentences = splitSentences(text);
    if (text.length > cfg.paragraph.maxChars && sentences.length > cfg.paragraph.maxSentences) errors.push(`長すぎる段落が残っています: ${text.slice(0, 30)}`);
  }
  detectShortRuns(paragraphs, cfg, errors);

  const markers = markerNodes(document);
  for (const marker of markers) if (!textContent(marker).trim()) errors.push("空のマーカーがあります");
  for (const section of headingRanges(document)) {
    const count = section.nodes.flatMap((node) => descendants(node, isMarkerNode)).length;
    if (count > cfg.markers.maxPerSection) errors.push(`見出し範囲のマーカー数が上限を超えています: ${section.id || section.title}`);
  }

  const sectionStats = markerSectionStats(document);
  return { ok: errors.length === 0, errors, metrics: { h2Count: h2s.length, articleTocLinkCount: tocLinks.length, h3Indexes: h3IndexReports, checkedParagraphCount: paragraphs.length, markerCount: markers.length, ...sectionStats } };
}

function emptyRunReport() { return { h2Count: 0, articleTocLinkCount: 0, removedArticleTocCount: 0, h3Indexes: [], checkedParagraphCount: 0, splitParagraphCount: 0, removedMarkerCount: 0, newMarkerCount: 0, markerCount: 0, eligibleSectionCount: 0, markedSectionCount: 0, unmarkedSections: [], errors: [] }; }
function mergeConfig(base, override = {}) { return { ...base, ...override, sectionIndexes: override.sectionIndexes ?? base.sectionIndexes, contentLists: override.contentLists ?? base.contentLists, paragraph: { ...base.paragraph, ...(override?.paragraph || {}) }, markers: { ...base.markers, ...(override?.markers || {}) } }; }
function tagName(node) { return node?.tagName || ""; }
function isElement(node) { return Boolean(node?.tagName); }
function childNodes(node) { return node.childNodes || []; }
function elements(root) { return descendants(root, isElement); }
function descendants(root, pred = () => true) { const out = []; walk(root, (node) => { if (node !== root && pred(node)) out.push(node); }); return out; }
function walk(node, fn) { fn(node); for (const child of childNodes(node)) walk(child, fn); }
function attrs(node) { if (!node.attrs) node.attrs = []; return node.attrs; }
function attr(node, name) { return attrs(node).find((item) => item.name === name)?.value || ""; }
function setAttr(node, name, value) { const found = attrs(node).find((item) => item.name === name); if (found) found.value = String(value); else attrs(node).push({ name, value: String(value) }); }
function hasClass(node, cls) { return attr(node, "class").split(/\s+/).includes(cls); }
function textNode(value) { return { nodeName: "#text", value, parentNode: null }; }
function textContent(node) { if (node.nodeName === "#text") return node.value || ""; return childNodes(node).map(textContent).join(""); }
function setChildren(node, children) { node.childNodes = children; for (const child of children) child.parentNode = node; }
function cloneTextElement(tag, text) { const node = { nodeName: tag, tagName: tag, attrs: [], namespaceURI: "http://www.w3.org/1999/xhtml", childNodes: [] }; setChildren(node, [textNode(text)]); return node; }
function parseNodes(html) { return parse5.parseFragment(html).childNodes; }
function parentOf(root, target) { let found = null; walk(root, (node) => { if (childNodes(node).includes(target)) found = node; }); return found; }
function closest(node, pred) { let current = node; while (current) { if (pred(current)) return current; current = current.parentNode; } return null; }
function indexInParent(root, node) { const parent = parentOf(root, node); return { parent, index: parent ? childNodes(parent).indexOf(node) : -1 }; }
function headings(root, tag) { return elements(root).filter((node) => tagName(node) === tag); }
function headingText(node) { return textContent(node).replace(/\s+/g, " ").trim(); }
function slug(text) { return String(text).toLowerCase().replace(/<[^>]+>/g, "").replace(/[\s　]+/g, "-").replace(/[^a-z0-9\-ぁ-んァ-ヶ一-龠ー]/gu, "").slice(0, 40) || "title"; }
function secId(index) { return `sec-${String(index).padStart(2, "0")}`; }

function unwrapExistingMarkers(root, report) { for (const node of [...elements(root)]) { if (isMarkerNode(node) || attr(node, DECORATION_ATTR) === "marker") { const { parent, index } = indexInParent(root, node); if (!parent) continue; parent.childNodes.splice(index, 1, ...childNodes(node)); for (const child of childNodes(node)) child.parentNode = parent; report.removedMarkerCount += 1; } } }
function isMarkerNode(node) { return (tagName(node) === "span" && hasClass(node, "swl-marker")) || (tagName(node) === "mark" && hasClass(node, "has-swl-deep-01-color")); }
function markerNodes(root) { return descendants(root, isMarkerNode); }
function removeGeneratedDecorations(root) {
  for (const node of [...elements(root)].filter((n) => attr(n, DECORATION_ATTR))) {
    const { parent, index } = indexInParent(root, node);
    if (!parent) continue;
    if (attr(node, DECORATION_ATTR) === "content-list") {
      const content = descendants(node, (child) => hasClass(child, "cap_box_content"))[0];
      const preserved = content ? [...childNodes(content)] : [];
      parent.childNodes.splice(index, 1, ...preserved);
      for (const child of preserved) child.parentNode = parent;
    } else {
      parent.childNodes.splice(index, 1);
    }
  }
}
function generatedBlocks(root, type) { return elements(root).filter((node) => attr(node, DECORATION_ATTR) === type); }

function collectArticleTocPlan(root, cfg) {
  const title = String(cfg.articleTocTitle || DEFAULT_CONFIG.articleTocTitle);
  const toc = elements(root).find((node) => attr(node, DECORATION_ATTR) === "article-toc" || (hasClass(node, "cap_box") && textContent(node).includes(title)));
  if (!toc) return null;
  const links = descendants(toc, (node) => tagName(node) === "a" && attr(node, "href").startsWith("#"))
    .map((link) => ({ id: attr(link, "href").slice(1), text: headingText(link) || textContent(link).replace(/\s+/g, " ").trim() }))
    .filter((item) => item.id || item.text);
  if (links.length === 0) return null;
  return { ids: new Set(links.map((item) => item.id).filter(Boolean)), texts: new Set(links.map((item) => item.text).filter(Boolean)), links };
}

function targetArticleTocHeadings(root, tocPlan) {
  const h2s = headings(root, "h2");
  if (!tocPlan) return h2s;
  const matched = [];
  const used = new Set();
  for (const link of tocPlan.links) {
    const byId = link.id ? h2s.find((h2) => !used.has(h2) && attr(h2, "id") === link.id) : null;
    const byText = link.text ? h2s.find((h2) => !used.has(h2) && headingText(h2) === link.text) : null;
    const target = byId || byText;
    if (target) { matched.push(target); used.add(target); }
  }
  return matched;
}

function removeExistingArticleTocs(root, cfg, report) {
  const title = String(cfg.articleTocTitle || DEFAULT_CONFIG.articleTocTitle);
  for (const node of [...elements(root)]) {
    if (attr(node, DECORATION_ATTR) === "article-toc") continue;
    const text = textContent(node);
    const isCapBoxToc = hasClass(node, "cap_box") && text.includes(title);
    const isPlainTocList = ["ul", "ol"].includes(tagName(node)) && text.includes(title);
    const isHeadingToc = /^h[2-4]$/.test(tagName(node)) && headingText(node) === title;
    if (!isCapBoxToc && !isPlainTocList && !isHeadingToc) continue;
    const { parent, index } = indexInParent(root, node);
    if (!parent) continue;
    parent.childNodes.splice(index, 1);
    report.removedArticleTocCount = (report.removedArticleTocCount || 0) + 1;
  }
}

function assignHeadingIds(root, tocPlan = null) {
  const used = new Set(elements(root).map((node) => attr(node, "id")).filter(Boolean));
  const existingSecNumbers = [...used].map((id) => id.match(/^sec-([0-9]{2,})$/u)?.[1]).filter(Boolean).map(Number);
  let nextSecNumber = existingSecNumbers.length > 0 ? Math.max(...existingSecNumbers) + 1 : 1;
  const tocTargets = new Set(targetArticleTocHeadings(root, tocPlan));
  for (const h of headings(root, "h2")) {
    const current = attr(h, "id").trim();
    if (/^sec-[0-9]{2,}$/u.test(current)) continue;
    if (tocTargets.has(h)) {
      let id = secId(nextSecNumber++);
      while (used.has(id)) id = secId(nextSecNumber++);
      setAttr(h, "id", id);
      used.add(id);
    }
  }
}
function buildArticleToc(root, cfg, tocPlan = null) { const h2s = targetArticleTocHeadings(root, tocPlan); if (h2s.length === 0) return; const items = h2s.map((h) => `<li><a href="#${escapeAttr(attr(h, "id"))}">${escapeHtml(headingText(h))}</a></li>`).join(""); const nodes = parseNodes(`<div class="cap_box" data-poipoi-decoration="article-toc"><div class="cap_box_ttl"><span>${escapeHtml(cfg.articleTocTitle)}</span></div><div class="cap_box_content"><ul>${items}</ul></div></div>`); const pos = indexInParent(root, h2s[0]); if (pos.parent) { pos.parent.childNodes.splice(pos.index, 0, ...nodes); for (const node of nodes) node.parentNode = pos.parent; } }

function resolveSection(root, section) { const h2s = headings(root, "h2"); if (section.h2Id) { const h2 = h2s.find((node) => attr(node, "id") === section.h2Id); return { h2, index: h2 ? h2s.indexOf(h2) + 1 : null }; } if (section.h2Text) { const h2 = h2s.find((node) => headingText(node) === section.h2Text || headingText(node).includes(section.h2Text)); return { h2, index: h2 ? h2s.indexOf(h2) + 1 : null }; } if (section.h2Index) { const h2 = h2s[section.h2Index - 1]; return { h2, index: h2 ? section.h2Index : null }; } return { h2: null, index: null }; }
function sectionKey(section, fallbackIndex) { return section.h2Id ? `id-${slug(section.h2Id)}` : section.h2Text ? `text-${slug(section.h2Text)}` : String(section.h2Index || fallbackIndex); }
function sectionLabel(section) { return section.h2Id ? `h2Id=${section.h2Id}` : section.h2Text ? `h2Text=${section.h2Text}` : `h2Index=${section.h2Index}`; }
function buildSectionIndexes(root, cfg, report) { for (const section of cfg.sectionIndexes || []) { const resolved = resolveSection(root, section); if (!resolved.h2) { if (section.required) report.errors.push(`対象H2が見つかりません: ${sectionLabel(section)}`); continue; } const h3s = h3sInSection(root, resolved.h2); if (h3s.length === 0) continue; h3s.forEach((h3, index) => { if (!attr(h3, "id")) setAttr(h3, "id", `sub-${String(index + 1).padStart(2, "0")}`); }); const key = sectionKey(section, resolved.index); const items = h3s.map((h3) => `<li><a href="#${escapeAttr(attr(h3, "id"))}">${escapeHtml(headingText(h3))}</a></li>`).join(""); const nodes = parseNodes(`<div class="cap_box" data-poipoi-decoration="section-index-${key}"><div class="cap_box_ttl"><span>${escapeHtml(section.title)}</span></div><div class="cap_box_content"><ul>${items}</ul></div></div>`); const insertAfter = firstIntroParagraphAfterH2(root, resolved.h2) || resolved.h2; const pos = indexInParent(root, insertAfter); if (pos.parent) { pos.parent.childNodes.splice(pos.index + 1, 0, ...nodes); for (const node of nodes) node.parentNode = pos.parent; } } }
function h3sInSection(root, h2) { const flat = elements(root); const start = flat.indexOf(h2); const out = []; for (let i = start + 1; i < flat.length; i++) { if (tagName(flat[i]) === "h2") break; if (tagName(flat[i]) === "h3") out.push(flat[i]); } return out; }
function firstIntroParagraphAfterH2(root, h2) { const flat = elements(root); const start = flat.indexOf(h2); for (let i = start + 1; i < flat.length; i++) { if (["h2", "h3"].includes(tagName(flat[i]))) return null; if (tagName(flat[i]) === "p") return flat[i]; } return null; }

function wrapConfiguredLists(root, cfg, report) { for (const item of cfg.contentLists || []) { const lists = [...elements(root)].filter((node) => matchesSelector(node, item.selector)); if (item.required && lists.length === 0) report.errors.push(`必須contentLists selectorが見つかりません: ${item.selector}`); for (const list of lists) { if (closest(parentOf(root, list), (node) => hasClass(node, "cap_box") || attr(node, DECORATION_ATTR) === "content-list")) continue; const wrapper = parseNodes(`<div class="cap_box" data-poipoi-decoration="content-list"><div class="cap_box_ttl"><span>${escapeHtml(item.title)}</span></div><div class="cap_box_content"></div></div>`)[0]; const content = descendants(wrapper, (node) => hasClass(node, "cap_box_content"))[0]; const pos = indexInParent(root, list); if (!pos.parent) continue; pos.parent.childNodes.splice(pos.index, 1, wrapper); wrapper.parentNode = pos.parent; setChildren(content, [list]); list.parentNode = content; } } }
function matchesSelector(node, selector) { if (!selector) return false; const m = selector.match(/^([a-z0-9]+)?(?:\.([a-z0-9_-]+))?$/i); if (!m) return false; return (!m[1] || tagName(node) === m[1].toLowerCase()) && (!m[2] || hasClass(node, m[2])); }

function excludedAncestor(node) { return closest(node, (p) => hasClass(p, "cap_box") || ["figure", "table", "blockquote", "li"].includes(tagName(p))); }
function targetParagraphs(root) { return elements(root).filter((node) => tagName(node) === "p" && !excludedAncestor(parentOf(root, node))); }
function splitLongParagraphs(root, cfg, report) { for (const p of [...targetParagraphs(root)]) { const before = textContent(p); const sentences = splitSentences(before); if (before.length <= cfg.paragraph.maxChars || sentences.length <= cfg.paragraph.maxSentences) continue; const chunks = chunk(sentences, cfg.paragraph.targetSentencesPerParagraph).map((parts) => parts.join("")); if (chunks.length <= 1) continue; const newPs = chunks.map((text) => cloneTextElement("p", text)); if (newPs.map(textContent).join("") !== before) continue; const pos = indexInParent(root, p); if (pos.parent) { pos.parent.childNodes.splice(pos.index, 1, ...newPs); for (const n of newPs) n.parentNode = pos.parent; report.splitParagraphCount += 1; } } }
function splitSentences(text) { return String(text).match(/[^。！？!?]+[。！？!?]?/gu)?.filter(Boolean) || [String(text)]; }
function chunk(items, size) { const out = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
function detectShortRuns(paragraphs, cfg, errors) { let run = 0; for (const p of paragraphs) { if (textContent(p).trim().length <= cfg.paragraph.shortParagraphChars) run += 1; else run = 0; if (run >= cfg.paragraph.shortParagraphRun) errors.push("極端に短い連続段落があります"); } }

function headingRanges(root) { const hs = elements(root).filter((n) => /^h[23]$/.test(tagName(n))); return hs.map((h) => { const flat = elements(root); const start = flat.indexOf(h); const nodes = []; for (let j = start + 1; j < flat.length; j++) { if (/^h[23]$/.test(tagName(flat[j]))) break; nodes.push(flat[j]); } return { title: headingText(h), id: attr(h, "id"), nodes }; }); }
function eligibleParagraphsForSection(root, section) { return section.nodes.filter((node) => tagName(node) === "p" && !closest(parentOf(root, node), (a) => ["a", "li", "table", "figure"].includes(tagName(a)) || attr(a, DECORATION_ATTR))); }
function applyMarkers(root, cfg, report) { const ranges = headingRanges(root); for (const section of ranges) { const paragraphs = eligibleParagraphsForSection(root, section).filter((p) => textContent(p).trim()); if (paragraphs.length === 0) continue; report.eligibleSectionCount += 1; let count = 0; for (const p of paragraphs) { if (count >= cfg.markers.maxPerSection) break; const before = textContent(p); const negative = cfg.markers.negativeKeywords.find((k) => before.includes(k)); const positive = cfg.markers.positiveKeywords.find((k) => before.includes(k)); const target = negative || positive || fallbackMarkerText(before); if (!target) continue; wrapTextInMarker(p, target, Boolean(negative)); if (textContent(p) === before) { count += 1; report.newMarkerCount += 1; } } if (count > 0) report.markedSectionCount += 1; else report.unmarkedSections.push({ id: section.id, title: section.title }); } }
function fallbackMarkerText(text) { const sentence = splitSentences(text).map((s) => s.trim()).filter(Boolean).sort((a, b) => b.length - a.length)[0] || ""; return sentence.length > 42 ? sentence.slice(0, 42) : sentence; }
function wrapTextInMarker(node, target, negative) { for (let i = 0; i < childNodes(node).length; i++) { const child = node.childNodes[i]; if (child.nodeName !== "#text") continue; const idx = child.value.indexOf(target); if (idx < 0) continue; const marker = negative ? parseNodes(`<mark style="background-color:rgba(0, 0, 0, 0)" class="has-inline-color has-swl-deep-01-color" data-poipoi-decoration="marker">${escapeHtml(target)}</mark>`)[0] : parseNodes(`<span class="swl-marker mark_yellow" data-poipoi-decoration="marker">${escapeHtml(target)}</span>`)[0]; const parts = [textNode(child.value.slice(0, idx)), marker, textNode(child.value.slice(idx + target.length))].filter((n) => n.nodeName !== "#text" || n.value); node.childNodes.splice(i, 1, ...parts); for (const part of parts) part.parentNode = node; return; } }
function markerSectionStats(root) { const eligible = []; const unmarked = []; let marked = 0; for (const section of headingRanges(root)) { const paragraphs = eligibleParagraphsForSection(root, section).filter((p) => textContent(p).trim()); if (paragraphs.length === 0) continue; eligible.push(section); const count = section.nodes.flatMap((node) => descendants(node, isMarkerNode)).length; if (count > 0) marked += 1; else unmarked.push({ id: section.id, title: section.title }); } return { eligibleSectionCount: eligible.length, markedSectionCount: marked, unmarkedSections: unmarked }; }
function idExists(ids, href) { return href?.startsWith("#") && ids.includes(href.slice(1)); }

function stripHeadingBlockComments(html) {
  return String(html).replace(/[ \t]*<!--\s*\/?wp:heading(?:\s+[^>]*)?\s*-->[ \t]*(?:\r?\n)?/gu, "");
}

function serializeHeadingBlocks(html) {
  return stripHeadingBlockComments(html).replace(/<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>\s*/giu, (match, level, attrsText) => {
    const idMatch = attrsText.match(/\bid\s*=\s*(["'])(.*?)\1/iu);
    const id = idMatch ? idMatch[2] : "";
    const headingHtml = ensureClass(match.trimEnd(), "wp-block-heading");
    const json = level === "2"
      ? (id ? ` {"anchor":"${escapeJson(id)}"}` : "")
      : (id ? ` {"level":3,"anchor":"${escapeJson(id)}"}` : " {" + '"level":3' + "}");
    return `<!-- wp:heading${json} -->\n${headingHtml}\n<!-- /wp:heading -->`;
  });
}

function ensureClass(html, cls) {
  return String(html).replace(/<h([23])\b([^>]*)>/iu, (opening, level, attrsText) => {
    const classMatch = attrsText.match(/\bclass\s*=\s*(["'])(.*?)\1/iu);
    if (classMatch) {
      if (classMatch[2].split(/\s+/u).includes(cls)) return opening;
      return opening.replace(classMatch[0], `class=${classMatch[1]}${classMatch[2]} ${cls}${classMatch[1]}`);
    }
    return `<h${level} class="${cls}"${attrsText}>`;
  });
}

function escapeJson(value) { return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }
