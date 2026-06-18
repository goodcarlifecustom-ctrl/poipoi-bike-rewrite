#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decorateArticleHtml, loadArticleDecorationConfig } from "./lib/article-decoration.mjs";

const articleDir = process.argv[2] || "articles/sample-article";
const rewrittenPath = join(articleDir, "rewritten.html");
const previewPath = join(articleDir, "rewritten.decorated.html");
const reportPath = join(articleDir, "decoration-run-report.json");
const config = await loadArticleDecorationConfig("rules/article-decoration.json", articleDir);
const source = await readFile(rewrittenPath, "utf8");
const { html, report } = decorateArticleHtml(source, config);
await mkdir(articleDir, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (report.errors.length > 0) {
  console.error(`装飾検証に失敗しました: ${report.errors.join("; ")}`);
  process.exit(1);
}
await writeFile(previewPath, html, "utf8");
console.log(`装飾プレビューを保存しました（rewritten.htmlは未変更）: ${previewPath}`);
console.log(`装飾実行レポートを保存しました: ${reportPath}`);
