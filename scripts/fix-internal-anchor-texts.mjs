#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as parse5 from "parse5";

const articleDir = process.argv[2] || process.env.ARTICLE_DIR || "articles/sample-article";
const rewrittenPath = path.join(articleDir, "rewritten.html");
const reportPath = path.join(articleDir, "anchor-link-report.json");
const ARTICLE_TOC_TITLE = "この記事でわかること";

function isElement(node, tagName) { return node?.nodeName === tagName && node?.tagName === tagName; }
function isHeading(node) { return isElement(node, "h2") || isElement(node, "h3") || isElement(node, "h4"); }
function getAttr(node, name) { return node.attrs?.find((attr) => attr.name === name)?.value || ""; }
function hasClass(node, cls) { return getAttr(node, "class").split(/\s+/u).includes(cls); }
function textContent(node) { if (!node) return ""; if (node.nodeName === "#text") return node.value || ""; return (node.childNodes || []).map(textContent).join(""); }
function normalizeText(value) { return String(value).replace(/\s+/gu, " ").trim(); }
function replaceText(node, value) { node.childNodes = [{ nodeName: "#text", value, parentNode: node }]; }
function walk(node, callback) { callback(node); for (const child of node.childNodes || []) walk(child, callback); }
function descendants(root, pred) { const out = []; walk(root, (node) => { if (node !== root && pred(node)) out.push(node); }); return out; }
function closest(node, pred) { let current = node; while (current) { if (pred(current)) return current; current = current.parentNode; } return null; }

function collectTargets(documentFragment) {
  const ids = new Map();
  const headingTargets = new Map();
  const duplicateHeadingIds = [];
  const emptyHeadingTexts = [];
  const seenDuplicateHeadingIds = new Set();
  const h2Targets = [];

  walk(documentFragment, (node) => {
    if (!node?.tagName) return;
    const id = getAttr(node, "id");
    if (id) {
      if (!ids.has(id)) ids.set(id, []);
      ids.get(id).push({ tagName: node.tagName, isHeading: isHeading(node) });
    }
    if (!isHeading(node) || !id) return;
    const headingText = normalizeText(textContent(node));
    if (!headingText) emptyHeadingTexts.push({ id, tagName: node.tagName });
    if (node.tagName === "h2") h2Targets.push({ id, tagName: node.tagName, text: headingText });
    if (headingTargets.has(id)) {
      if (!seenDuplicateHeadingIds.has(id)) {
        duplicateHeadingIds.push({ id, tagNames: [headingTargets.get(id).tagName, node.tagName] });
        seenDuplicateHeadingIds.add(id);
      }
      return;
    }
    headingTargets.set(id, { id, tagName: node.tagName, text: headingText });
  });

  return { ids, headingTargets, h2Targets, duplicateHeadingIds, emptyHeadingTexts };
}

function internalIdFromHref(href) { if (!href || !href.startsWith("#") || href === "#") return null; try { return decodeURIComponent(href.slice(1)); } catch { return href.slice(1); } }

function validateSerializedAnchorSpec(html) {
  const tocLinks = [];
  const fragment = parse5.parseFragment(html);
  walk(fragment, (node) => {
    if (!isElement(node, "a") || !closest(node, isArticleToc)) return;
    const href = getAttr(node, "href");
    const id = internalIdFromHref(href);
    if (id) tocLinks.push({ href, targetId: id, text: normalizeText(textContent(node)) });
  });
  const idCounts = new Map();
  const headingBlocks = [];
  for (const match of html.matchAll(/<!--\s*wp:heading\s*(\{[\s\S]*?\})?\s*-->\s*(<h([23])\b([\s\S]*?)>[\s\S]*?<\/h\3>)\s*<!--\s*\/wp:heading\s*-->/giu)) {
    let anchor = "";
    try { anchor = match[1] ? JSON.parse(match[1]).anchor || "" : ""; } catch { anchor = ""; }
    const attrsText = match[4] || "";
    const id = attrsText.match(/\bid\s*=\s*(["'])(.*?)\1/iu)?.[2] || "";
    const text = normalizeText(match[2].replace(/<[^>]+>/gu, " "));
    headingBlocks.push({ level: Number(match[3]), anchor, id, text });
  }
  for (const match of html.matchAll(/\bid\s*=\s*(["'])(.*?)\1/giu)) idCounts.set(match[2], (idCounts.get(match[2]) || 0) + 1);
  const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
  const h2ById = new Map(headingBlocks.filter((h) => h.level === 2 && h.id).map((h) => [h.id, h]));
  const missingTargets = [];
  const anchorMismatches = [];
  const textMismatches = [];
  const nonAsciiAnchorIds = [];
  const unserializedTargetHeadings = [];
  for (const link of tocLinks) {
    const target = h2ById.get(link.targetId);
    if (!target) { missingTargets.push(link); continue; }
    if (target.anchor !== link.targetId || target.id !== link.targetId) anchorMismatches.push({ href: link.href, anchor: target.anchor, id: target.id });
    if (link.text !== target.text) textMismatches.push({ href: link.href, linkText: link.text, headingText: target.text });
  }
  for (const id of idCounts.keys()) if (id.startsWith("sec-") && !/^sec-[0-9]{2,}$/u.test(id)) nonAsciiAnchorIds.push(id);
  for (const link of tocLinks) {
    if (html.includes(`id="${link.targetId}"`) && !h2ById.has(link.targetId)) unserializedTargetHeadings.push(link);
  }
  return { tocLinkCount: tocLinks.length, tocLinks, headingBlocks, duplicateIds, missingTargets, anchorMismatches, textMismatches, nonAsciiAnchorIds, unserializedTargetHeadings };
}

function isArticleToc(node) { return Boolean(node?.tagName) && (getAttr(node, "data-poipoi-decoration") === "article-toc" || (hasClass(node, "cap_box") && normalizeText(textContent(node)).includes(ARTICLE_TOC_TITLE))); }

const html = await readFile(rewrittenPath, "utf8");
const fragment = parse5.parseFragment(html);
const { ids, headingTargets, h2Targets, duplicateHeadingIds, emptyHeadingTexts } = collectTargets(fragment);
const fixes = [];
const missingTargetIds = [];
const invalidTargetIds = [];
const emptyAnchorTexts = [];
const postFixMismatches = [];
const emptyArticleTocItems = [];
let checkedAnchorLinks = 0;
let matchedLinks = 0;
let fixedLinks = 0;
let articleTocLinkCount = 0;
const articleTocTargetIds = new Set();

walk(fragment, (node) => {
  if (isElement(node, "li") && closest(node, isArticleToc)) {
    const links = descendants(node, (child) => isElement(child, "a") && Boolean(internalIdFromHref(getAttr(child, "href"))));
    if (links.length === 0) emptyArticleTocItems.push({ text: normalizeText(textContent(node)) });
  }
  if (!isElement(node, "a")) return;
  const href = getAttr(node, "href");
  const targetId = internalIdFromHref(href);
  if (!targetId) return;

  checkedAnchorLinks += 1;
  const inArticleToc = closest(node, isArticleToc);
  if (inArticleToc) { articleTocLinkCount += 1; articleTocTargetIds.add(targetId); }
  const before = normalizeText(textContent(node));
  if (!before) emptyAnchorTexts.push({ href, targetId });

  const target = headingTargets.get(targetId);
  if (!target) {
    if (ids.has(targetId)) invalidTargetIds.push({ href, targetId, anchorText: before, targetElements: ids.get(targetId).map(({ tagName }) => tagName) });
    else missingTargetIds.push({ href, targetId, anchorText: before });
    return;
  }

  const after = target.text;
  if (before === after) matchedLinks += 1;
  else { replaceText(node, after); fixedLinks += 1; fixes.push({ href, before, after, targetHeading: target.text }); }

  const finalAnchorText = normalizeText(textContent(node));
  if (finalAnchorText !== target.text) postFixMismatches.push({ href, targetId, anchorText: finalAnchorText, targetHeading: target.text });
});

const h2TargetCount = h2Targets.length;
const missingArticleTocLinks = h2Targets.filter((h2) => /^sec-[0-9]{2,}$/u.test(h2.id) && !articleTocTargetIds.has(h2.id)).map(({ id, text }) => ({ id, text }));
const noInternalAnchorsWithH2 = h2TargetCount > 0 && checkedAnchorLinks === 0;
const serialized = parse5.serialize(fragment);
const specReport = validateSerializedAnchorSpec(serialized);
const specOk = ["duplicateIds", "missingTargets", "anchorMismatches", "textMismatches", "nonAsciiAnchorIds", "unserializedTargetHeadings"].every((key) => specReport[key].length === 0);
const ok = duplicateHeadingIds.length === 0 && missingTargetIds.length === 0 && invalidTargetIds.length === 0 && emptyAnchorTexts.length === 0 && emptyHeadingTexts.length === 0 && postFixMismatches.length === 0 && !noInternalAnchorsWithH2 && emptyArticleTocItems.length === 0 && missingArticleTocLinks.length === 0 && specOk;

const report = { ...specReport, ok, articleDir, h2TargetCount, checkedAnchorLinks, articleTocLinkCount, missingArticleTocLinks, emptyArticleTocItems, matchedLinks, fixedLinks, missingTargetIds, duplicateHeadingIds, invalidTargetIds, emptyAnchorTexts, emptyHeadingTexts, postFixMismatches, fixes, finalJudgement: ok ? "PASS" : "FAIL" };
console.log(JSON.stringify(report, null, 2));
if (ok) await writeFile(rewrittenPath, serialized, "utf8");
await mkdir(articleDir, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (!ok) process.exitCode = 1;
