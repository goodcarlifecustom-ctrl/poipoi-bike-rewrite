#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureRequiredAnchors, loadRequiredLinks, validateRequiredAnchors } from "./lib/required-links.mjs";

const articleDir = process.argv[2] || "articles/sample-article";
const rewrittenPath = path.join(articleDir, "rewritten.html");
const requiredLinks = await loadRequiredLinks("rules/required-links.json");
const html = await readFile(rewrittenPath, "utf8");
const ensured = ensureRequiredAnchors(html, requiredLinks);
await writeFile(rewrittenPath, ensured, "utf8");
const validation = validateRequiredAnchors(ensured, requiredLinks);
if (!validation.ok) {
  console.error(validation.errors.join("\n"));
  process.exit(1);
}
console.log(`必須リンクを検証しました: ${rewrittenPath}`);
