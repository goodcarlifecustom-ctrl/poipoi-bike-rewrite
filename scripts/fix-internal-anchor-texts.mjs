#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as parse5 from "parse5";

const articleDir = process.argv[2] || "articles/sample-article";
const rewrittenPath = path.join(articleDir, "rewritten.html");
const reportPath = path.join(articleDir, "anchor-link-report.json");

function isElement(node, tagName) {
  return node?.nodeName === tagName && node?.tagName === tagName;
}

function getAttr(node, name) {
  return node.attrs?.find((attr) => attr.name === name)?.value;
}

function textContent(node) {
  if (!node) return "";
  if (node.nodeName === "#text") return node.value || "";
  if (!node.childNodes) return "";
  return node.childNodes.map(textContent).join("");
}

function normalizeText(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function replaceText(node, value) {
  node.childNodes = [{ nodeName: "#text", value, parentNode: node }];
}

function walk(node, callback) {
  callback(node);
  for (const child of node.childNodes || []) walk(child, callback);
}

function collectHeadingTargets(documentFragment) {
  const targets = new Map();
  walk(documentFragment, (node) => {
    if (!isElement(node, "h2") && !isElement(node, "h3") && !isElement(node, "h4")) return;
    const id = getAttr(node, "id");
    if (!id || targets.has(id)) return;
    targets.set(id, {
      id,
      tagName: node.tagName,
      text: normalizeText(textContent(node)),
    });
  });
  return targets;
}

function internalIdFromHref(href) {
  if (!href || !href.startsWith("#") || href === "#") return null;
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}

const html = await readFile(rewrittenPath, "utf8");
const fragment = parse5.parseFragment(html);
const headingTargets = collectHeadingTargets(fragment);
const fixes = [];
const missingTargetIds = [];
let checkedAnchorLinks = 0;
let matchedLinks = 0;
let fixedLinks = 0;

walk(fragment, (node) => {
  if (!isElement(node, "a")) return;
  const href = getAttr(node, "href");
  const targetId = internalIdFromHref(href);
  if (!targetId) return;

  checkedAnchorLinks += 1;
  const target = headingTargets.get(targetId);
  if (!target) {
    missingTargetIds.push({ href, targetId, anchorText: normalizeText(textContent(node)) });
    return;
  }

  const before = normalizeText(textContent(node));
  const after = target.text;
  if (before === after) {
    matchedLinks += 1;
    return;
  }

  replaceText(node, after);
  fixedLinks += 1;
  fixes.push({ href, before, after, targetHeading: target.text });
});

const report = {
  ok: missingTargetIds.length === 0,
  checkedAnchorLinks,
  matchedLinks,
  fixedLinks,
  missingTargetIds,
  fixes,
  finalJudgement: missingTargetIds.length === 0 ? "PASS" : "FAIL",
};

console.log(JSON.stringify(report, null, 2));

if (report.ok) {
  await writeFile(rewrittenPath, parse5.serialize(fragment), "utf8");
}
await mkdir(articleDir, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!report.ok) process.exitCode = 1;
