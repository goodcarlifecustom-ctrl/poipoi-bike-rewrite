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
const missingArticleTocLinks = h2Targets.filter((h2) => !articleTocTargetIds.has(h2.id)).map(({ id, text }) => ({ id, text }));
const noInternalAnchorsWithH2 = h2TargetCount > 0 && checkedAnchorLinks === 0;
const ok = duplicateHeadingIds.length === 0 && missingTargetIds.length === 0 && invalidTargetIds.length === 0 && emptyAnchorTexts.length === 0 && emptyHeadingTexts.length === 0 && postFixMismatches.length === 0 && !noInternalAnchorsWithH2 && emptyArticleTocItems.length === 0 && missingArticleTocLinks.length === 0;

const report = { ok, articleDir, h2TargetCount, checkedAnchorLinks, articleTocLinkCount, missingArticleTocLinks, emptyArticleTocItems, matchedLinks, fixedLinks, missingTargetIds, duplicateHeadingIds, invalidTargetIds, emptyAnchorTexts, emptyHeadingTexts, postFixMismatches, fixes, finalJudgement: ok ? "PASS" : "FAIL" };
console.log(JSON.stringify(report, null, 2));
if (ok) await writeFile(rewrittenPath, parse5.serialize(fragment), "utf8");
await mkdir(articleDir, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (!ok) process.exitCode = 1;
