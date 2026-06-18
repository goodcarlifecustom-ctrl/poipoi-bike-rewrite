#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadArticleDecorationConfig, validateDecorations } from "./lib/article-decoration.mjs";

const articleDir = process.argv[2] || "articles/sample-article";
const inputPath = process.argv[3] || join(articleDir, "rewritten.html");
const reportPath = join(articleDir, "decoration-validation-report.json");
const config = await loadArticleDecorationConfig("rules/article-decoration.json", articleDir);
const html = await readFile(inputPath, "utf8");
const validation = validateDecorations(html, config);
const report = { ...validation.metrics, errors: validation.errors };
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (!validation.ok) {
  console.error(`装飾検証に失敗しました: ${validation.errors.join("; ")}`);
  process.exit(1);
}
console.log(`装飾検証に成功しました: ${inputPath}`);
