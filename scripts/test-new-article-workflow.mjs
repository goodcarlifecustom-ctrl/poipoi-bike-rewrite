#!/usr/bin/env node

import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";

const gscDir = path.join("gsc-data", "150cc-bike-osusume");
const articleDir = path.join("articles", "150cc-bike-osusume");
const sampleDir = path.join("articles", "sample-article");

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
async function writeGsc(rows) {
  await mkdir(gscDir, { recursive: true });
  const views = {
    topImpressions: [...rows].sort((a,b)=>b.impressions-a.impressions),
    topClicks: [...rows].sort((a,b)=>b.clicks-a.clicks),
    position8to20: rows.filter((r)=>r.position >= 8 && r.position <= 20).sort((a,b)=>b.impressions-a.impressions),
    ctrImprove: rows.filter((r)=>r.impressions >= 10).sort((a,b)=>a.ctr-b.ctr || b.impressions-a.impressions),
    relatedPages: [{ page: "https://poi-poi.co.jp/bike/example/", queries: ["150cc バイク おすすめ"], impressions: 120, clicks: 5 }],
  };
  await writeFile(path.join(gscDir, "search-console-rows.json"), `${JSON.stringify({ targetKeyword: "150cc バイク おすすめ", siteUrl: "https://poi-poi.co.jp/", startDate: "2026-03-17", endDate: "2026-06-15", rows, views }, null, 2)}\n`);
}
async function main() {
  await rm(articleDir, { recursive: true, force: true });
  await rm(gscDir, { recursive: true, force: true });
  const fixtureRows = [
    { query: "150cc バイク おすすめ", page: "https://poi-poi.co.jp/bike/a/", clicks: 12, impressions: 900, ctr: 0.0133, position: 7.2, matchedConditions: ["A", "B", "C"] },
    { query: "150cc バイク 高速", page: "https://poi-poi.co.jp/bike/b/", clicks: 4, impressions: 500, ctr: 0.008, position: 12.1, matchedConditions: ["C"] },
    { query: "150cc 125cc 違い", page: "https://poi-poi.co.jp/bike/c/", clicks: 2, impressions: 300, ctr: 0.0067, position: 18.4, matchedConditions: ["C"] },
  ];
  await writeGsc(fixtureRows);
  let result = await run("node", ["scripts/create-new-article.mjs"], { TARGET_KEYWORD: "150cc バイク おすすめ" });
  assert.equal(result.status, 0, result.stderr);
  const html = await readFile(path.join(articleDir, "article.html"), "utf8");
  const check = await readFile(path.join(articleDir, "check-report.md"), "utf8");
  assert(!/<h1\b/i.test(html), "article.html must not include h1");
  assert(html.includes("150cc バイク 高速"), "position/query fixture should affect article body");
  assert(check.includes("matchedConditions"), "check-report should record matchedConditions");
  assert(check.includes("150cc 125cc 違い"), "check-report should include fixture query");

  result = await run("node", ["scripts/create-wordpress-draft.mjs"], { ARTICLE_DIR: articleDir, WP_DRY_RUN: "1", WP_DRY_RUN_SCENARIO: "draft", WP_BASE_URL: "https://example.com" });
  assert.equal(result.status, 0, result.stderr);
  const wpResult = JSON.parse(await readFile(path.join(articleDir, "wordpress-draft-result.json"), "utf8"));
  assert.equal(wpResult.status, "draft");
  assert.equal(wpResult.action, "updated");

  result = await run("node", ["scripts/create-wordpress-draft.mjs"], { ARTICLE_DIR: articleDir, WP_DRY_RUN: "1", WP_DRY_RUN_SCENARIO: "published", WP_BASE_URL: "https://example.com" });
  assert.notEqual(result.status, 0, "published slug should fail");
  assert(result.stderr.includes("公開済み記事"), "published slug error should be explicit");

  result = await run("node", ["scripts/create-wordpress-draft.mjs"], { ARTICLE_DIR: articleDir, WP_DRY_RUN: "1", WP_DRY_RUN_SCENARIO: "none", WP_DRY_RUN_VERIFY_STATUS: "private", WP_BASE_URL: "https://example.com" });
  assert.notEqual(result.status, 0, "non-draft verify status should fail");
  assert(result.stderr.includes("draftではありません"), "non-draft verify error should be explicit");

  await writeGsc([]);
  await rm(articleDir, { recursive: true, force: true });
  result = await run("node", ["scripts/create-new-article.mjs"], { TARGET_KEYWORD: "150cc バイク おすすめ" });
  assert.equal(result.status, 0, result.stderr);
  const zeroHtml = await readFile(path.join(articleDir, "article.html"), "utf8");
  assert(zeroHtml.includes("検索実績は0件"), "zero fixture should be explicit");

  result = await run("node", ["scripts/create-new-article.mjs"], { TARGET_KEYWORD: "別キーワード" });
  assert.notEqual(result.status, 0, "unsupported keyword should fail");

  result = await run("node", ["scripts/create-wordpress-draft.mjs"], { WP_DRY_RUN: "1", WP_DRY_RUN_SCENARIO: "none", WP_BASE_URL: "https://example.com" });
  assert.equal(result.status, 0, result.stderr);
  const legacy = JSON.parse(await readFile(path.join(sampleDir, "wordpress-draft.json"), "utf8"));
  assert.equal(legacy.status, "draft");
  assert.equal(legacy.action, "created");
  console.log("fixture tests passed");
}
main().catch((error) => { console.error(error.message); process.exit(1); });
