#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toGutenbergBlocks, validateGutenbergBlocks } from "./lib/gutenberg-blocks.mjs";

const DEFAULT_ROOT = "articles";
const ARTICLE_OUTPUT_RE = /^(?:rewritten|article|article-linked|article-decorated|output|content|finalized[^/]*|wordpress-draft-[^.]+\.raw)\.html$/u;

async function discoverArticleOutputFiles(root = DEFAULT_ROOT) {
  const out = [];
  async function walk(dir) {
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const filePath = join(dir, entry.name);
      if (entry.isDirectory()) await walk(filePath);
      else if (ARTICLE_OUTPUT_RE.test(entry.name) && !/\.rendered\.html$/u.test(entry.name)) out.push(filePath);
    }
  }
  await walk(root);
  return out.sort();
}

const files = process.argv.length > 2 ? process.argv.slice(2) : await discoverArticleOutputFiles();
if (files.length === 0) {
  console.log("Gutenberg変換対象の記事出力ファイルはありません");
  process.exit(0);
}
let changed = 0;
for (const file of files) {
  if (/\.rendered\.html$/u.test(file)) {
    console.log(`skipped rendered verification file: ${file}`);
    continue;
  }
  const before = await readFile(file, "utf8");
  const after = toGutenbergBlocks(before);
  const validation = validateGutenbergBlocks(after);
  if (!validation.ok) throw new Error(`${file}: ${validation.errors.join("; ")}`);
  if (after !== before) {
    await writeFile(file, after, "utf8");
    changed += 1;
    console.log(`converted: ${file}`);
  } else {
    console.log(`unchanged: ${file}`);
  }
}
console.log(`Gutenberg変換完了: ${changed}/${files.length}件更新`);
