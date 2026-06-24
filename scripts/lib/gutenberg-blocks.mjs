import * as parse5 from "parse5";

const BLOCK_RE = /<!--\s*(\/?wp:[^\s>]+)(?:\s+[^>]*)?\s*-->/giu;
const FRONT_MATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---\r?\n+)/;

export function toGutenbergBlocks(input) {
  const { frontMatter, body } = splitFrontMatter(String(input ?? ""));
  if (isFullyGutenbergBody(body)) return `${frontMatter}${body}`;
  const converted = convertMixedBody(body).trim();
  return `${frontMatter}${converted}${converted ? "\n" : ""}`;
}

export function stripArticleFrontMatter(input) {
  return splitFrontMatter(String(input ?? "")).body;
}

export function hasGutenbergBlocks(input) {
  return /<!--\s*wp:[^>]+-->/u.test(String(input ?? ""));
}

export function validateGutenbergBlocks(input) {
  const text = String(input ?? "");
  const errors = [];
  const stack = [];
  for (const match of text.matchAll(BLOCK_RE)) {
    const token = match[1];
    if (token.startsWith("/wp:")) {
      const name = token.slice(1);
      const last = stack.pop();
      if (last !== name) errors.push(`ブロック終了コメントの対応が不正です: ${token}`);
    } else {
      stack.push(token);
    }
  }
  if (stack.length > 0) errors.push(`未終了のブロックがあります: ${stack.join(", ")}`);
  const markdownBody = stripMarkdownIgnoredRegions(stripArticleFrontMatter(text));
  const markdownPatterns = [
    { name: "Markdown見出し", re: /^#{1,6}\s+\S/m },
    { name: "Markdown画像", re: /!\[[^\]]*\]\([^\)\s]+\)/m },
    { name: "Markdown箇条書き", re: /^(?:\s*)[-*+]\s+\S/m },
  ];
  for (const { name, re } of markdownPatterns) if (re.test(markdownBody)) errors.push(`${name}が残っています`);
  return { ok: errors.length === 0, errors };
}

function isFullyGutenbergBody(body) {
  const ranges = findWpBlockRanges(body);
  if (ranges.length === 0) return false;
  let cursor = 0;
  for (const range of ranges) {
    if (body.slice(cursor, range.start).trim()) return false;
    cursor = range.end;
  }
  return !body.slice(cursor).trim();
}

function convertMixedBody(body) {
  let out = "";
  let cursor = 0;
  for (const range of findWpBlockRanges(body)) {
    out += convertHtmlChunk(body.slice(cursor, range.start));
    out += body.slice(range.start, range.end).trim() + "\n\n";
    cursor = range.end;
  }
  out += convertHtmlChunk(body.slice(cursor));
  return out.replace(/\n{3,}/g, "\n\n");
}

function findWpBlockRanges(text) {
  const ranges = [];
  const stack = [];
  BLOCK_RE.lastIndex = 0;
  for (const match of text.matchAll(BLOCK_RE)) {
    const token = match[1];
    const full = match[0];
    if (!token.startsWith("/wp:")) {
      stack.push({ name: token, start: match.index });
    } else {
      const name = token.slice(1);
      const last = stack.pop();
      if (last?.name === name && stack.length === 0) ranges.push({ start: last.start, end: match.index + full.length });
    }
  }
  return ranges;
}

function convertHtmlChunk(chunk) {
  if (!chunk.trim()) return "";
  const fragment = parse5.parseFragment(chunk, { sourceCodeLocationInfo: false });
  return fragment.childNodes.map(nodeToBlock).filter(Boolean).join("\n\n") + "\n\n";
}

function nodeToBlock(node) {
  if (node.nodeName === "#text") {
    return node.value.trim() ? paragraphBlock(escapeHtml(node.value.trim())) : "";
  }
  if (node.nodeName === "#comment") return `<!--${node.data}-->`;
  const tag = node.tagName;
  const html = outerHtml(node).trim();
  if (!html) return "";
  if (tag === "p") return `<!-- wp:paragraph -->\n${html}\n<!-- /wp:paragraph -->`;
  if (/^h[1-6]$/i.test(tag)) return headingBlock(node, html);
  if (tag === "ul" || tag === "ol") return listBlock(node, html);
  if (tag === "figure" && firstDescendant(node, n => n.tagName === "img")) return imageBlock(node, ensureClass(html, "wp-block-image"));
  if (tag === "img") return imageBlock(node, `<figure class="wp-block-image size-large">${html}</figure>`);
  if (tag === "figure" && hasClass(node, "wp-block-table")) return tableBlock(html);
  if (tag === "table") return tableBlock(`<figure class="wp-block-table">${html}</figure>`);
  if (tag === "blockquote") return quoteBlock(html);
  if (tag === "pre") return codeBlock(html);
  if (tag === "hr") return separatorBlock(ensureClass(html, "wp-block-separator"));
  const table = firstDescendant(node, n => n.tagName === "table");
  if (table && onlyWhitespaceOutsideTable(node)) return tableBlock(`<figure class="wp-block-table">${outerHtml(table).trim()}</figure>`);
  return `<!-- wp:html -->\n${html}\n<!-- /wp:html -->`;
}

function headingBlock(node, html) {
  const level = Number(node.tagName.slice(1));
  const withClass = ensureClass(html, "wp-block-heading");
  const id = attr(node, "id");
  const props = { ...(level !== 2 ? { level } : {}), ...(id ? { anchor: id } : {}) };
  const json = Object.keys(props).length ? ` ${JSON.stringify(props)}` : "";
  return `<!-- wp:heading${json} -->\n${withClass}\n<!-- /wp:heading -->`;
}

function listBlock(node, html) {
  const ordered = node.tagName === "ol";
  const props = { ...(ordered ? { ordered: true } : {}), ...(attr(node, "start") ? { start: Number(attr(node, "start")) || attr(node, "start") } : {}), ...(node.attrs?.some(a => a.name === "reversed") ? { reversed: true } : {}) };
  const json = Object.keys(props).length ? ` ${JSON.stringify(props)}` : "";
  const withClass = ensureClass(html, "wp-block-list");
  const inner = withClass.replace(/<li\b[\s\S]*?<\/li>/giu, m => `<!-- wp:list-item -->\n${m}\n<!-- /wp:list-item -->`);
  return `<!-- wp:list${json} -->\n${inner}\n<!-- /wp:list -->`;
}

function imageBlock(node, html) {
  const cls = attr(node, "class");
  const size = cls.match(/(?:^|\s)size-([^\s]+)/u)?.[1] || "large";
  const linked = /<a\b/i.test(html);
  const props = { sizeSlug: size, linkDestination: linked ? "custom" : "none" };
  return `<!-- wp:image ${JSON.stringify(props)} -->\n${html}\n<!-- /wp:image -->`;
}
function tableBlock(html) { return `<!-- wp:table -->\n${html}\n<!-- /wp:table -->`; }
function quoteBlock(html) { return `<!-- wp:quote -->\n${html}\n<!-- /wp:quote -->`; }
function codeBlock(html) { return `<!-- wp:code -->\n${html}\n<!-- /wp:code -->`; }
function separatorBlock(html) { return `<!-- wp:separator -->\n${html}\n<!-- /wp:separator -->`; }
function paragraphBlock(html) { return `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`; }

function splitFrontMatter(text) { const m = text.match(FRONT_MATTER_RE); return m ? { frontMatter: m[1], body: text.slice(m[1].length) } : { frontMatter: "", body: text }; }
function stripMarkdownIgnoredRegions(text) {
  let out = String(text);
  out = removeWpBlocksByNames(out, new Set(["wp:code", "wp:html"]));
  out = out.replace(/<pre\b[\s\S]*?<\/pre>/giu, "");
  out = out.replace(/<code\b[\s\S]*?<\/code>/giu, "");
  out = out.replace(/<script\b[\s\S]*?<\/script>/giu, "");
  out = out.replace(/<style\b[\s\S]*?<\/style>/giu, "");
  return out;
}
function removeWpBlocksByNames(text, names) {
  const ranges = findWpBlockRanges(text).filter((range) => {
    const opener = text.slice(range.start, range.end).match(/<!--\s*(wp:[^\s>]+)/u)?.[1];
    return names.has(opener);
  });
  let out = "";
  let cursor = 0;
  for (const range of ranges) {
    out += text.slice(cursor, range.start);
    cursor = range.end;
  }
  out += text.slice(cursor);
  return out;
}
function attr(node, name) { return node.attrs?.find(a => a.name === name)?.value || ""; }
function hasClass(node, cls) { return attr(node, "class").split(/\s+/).includes(cls); }
function ensureClass(html, cls) { return html.replace(/^<([a-z0-9]+)\b([^>]*)>/iu, (open, tag, attrs) => {
  const classes = cls.split(/\s+/).filter(Boolean);
  const m = attrs.match(/\bclass\s*=\s*(["'])(.*?)\1/iu);
  if (m) {
    const existing = m[2].split(/\s+/).filter(Boolean);
    const merged = [...existing];
    for (const c of classes) if (!merged.includes(c)) merged.push(c);
    if (merged.join(" ") === existing.join(" ")) return open;
    return open.replace(m[0], `class=${m[1]}${merged.join(" ")}${m[1]}`);
  }
  return `<${tag} class="${classes.join(" ")}"${attrs}>`;
}); }
function firstDescendant(node, pred) { if (pred(node)) return node; for (const child of node.childNodes || []) { const found = firstDescendant(child, pred); if (found) return found; } return null; }
function onlyWhitespaceOutsideTable(node) { const html = parse5.serialize(node).replace(/<table\b[\s\S]*?<\/table>/giu, "").replace(/<\/?(?:div|figure)[^>]*>/giu, "").trim(); return !html; }
function outerHtml(node) {
  if (!node.tagName) return parse5.serialize(node);
  const attrs = (node.attrs || []).map(a => ` ${a.name}="${String(a.value).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join("");
  const inner = parse5.serialize({ childNodes: node.childNodes || [] });
  return `<${node.tagName}${attrs}>${inner}</${node.tagName}>`;
}
function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
