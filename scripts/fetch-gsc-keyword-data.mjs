#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_KEYWORD = "150cc バイク おすすめ";
const OUT_DIR = path.join("gsc-data", "150cc-bike-osusume");
const ROW_LIMIT = 1000;
const MAX_ROWS = 25000;
const dimensions = ["query", "page"];

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} が設定されていません。`);
  return value.trim();
}
function daysAgo(days) { const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); }
function pct(v) { return `${((Number(v) || 0) * 100).toFixed(2)}%`; }
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function rowKey(row) { return `${row.query}\u0000${row.page}`; }
function mdEscape(v) { return String(v ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim(); }
function table(rows) {
  if (!rows.length) return "取得結果は0件です。\n";
  const lines = ["| query | page | clicks | impressions | CTR | average position |", "|---|---:|---:|---:|---:|---:|"];
  for (const row of rows.slice(0, 20)) lines.push(`| ${mdEscape(row.query)} | ${mdEscape(row.page)} | ${row.clicks} | ${row.impressions} | ${pct(row.ctr)} | ${num(row.position).toFixed(1)} |`);
  return `${lines.join("\n")}\n`;
}
function filters(expressions) {
  return [{ groupType: "and", filters: expressions.map((expression) => ({ dimension: "query", operator: "contains", expression })) }];
}
const conditions = [
  { id: "A", name: "厳密な検索意図", expressions: ["150cc", "バイク", "おすすめ"] },
  { id: "B", name: "中程度の関連検索", expressions: ["150cc", "バイク"] },
  { id: "C", name: "広い関連検索", expressions: ["150cc"] },
];
async function writeFailure(message, details = {}) {
  await mkdir(OUT_DIR, { recursive: true });
  const now = new Date().toISOString();
  await writeFile(path.join(OUT_DIR, "request-summary.json"), `${JSON.stringify({ ok: false, generatedAt: now, error: message, ...details }, null, 2)}\n`);
  await writeFile(path.join(OUT_DIR, "search-console-rows.json"), "[]\n");
  await writeFile(path.join(OUT_DIR, "search-console.md"), `# Search Consoleデータ取得レポート\n\n## 取得概要\n\n- 取得結果: 失敗\n- 失敗理由: ${message}\n- 取得日時: ${now}\n\n## 注意事項\n\nSearch Consoleの値は、自サイトがGoogle検索に表示された実績であり、検索市場全体の検索ボリュームではありません。\n`);
}
async function main() {
  const targetKeyword = process.env.TARGET_KEYWORD?.trim() || DEFAULT_KEYWORD;
  const siteUrl = requireEnv("GSC_SITE_URL");
  const lookback = Math.max(1, Number.parseInt(process.env.GSC_LOOKBACK_DAYS || "90", 10) || 90);
  const endDate = daysAgo(3);
  const startDate = daysAgo(3 + lookback);
  let credentials;
  try { credentials = JSON.parse(requireEnv("GSC_SERVICE_ACCOUNT_JSON")); } catch { throw new Error("GSC_SERVICE_ACCOUNT_JSON のJSON解析に失敗しました。"); }
  const auth = new google.auth.GoogleAuth({ credentials, scopes: [SCOPE] });
  const client = google.searchconsole({ version: "v1", auth });
  const calls = [];
  const rowsByKey = new Map();
  const conditionCounts = {};
  for (const condition of conditions) {
    let startRow = 0; let fetchedForCondition = 0;
    while (startRow < MAX_ROWS) {
      const requestBody = { startDate, endDate, dimensions, dimensionFilterGroups: filters(condition.expressions), rowLimit: ROW_LIMIT, startRow };
      calls.push({ condition: condition.id, requestBody });
      const res = await client.searchanalytics.query({ siteUrl, requestBody });
      const apiRows = res.data.rows || [];
      fetchedForCondition += apiRows.length;
      for (const apiRow of apiRows) {
        const row = { query: apiRow.keys?.[0] || "", page: apiRow.keys?.[1] || "", clicks: num(apiRow.clicks), impressions: num(apiRow.impressions), ctr: num(apiRow.ctr), position: num(apiRow.position) };
        const key = rowKey(row);
        const existing = rowsByKey.get(key);
        if (existing) existing.matchedConditions.push(condition.id);
        else rowsByKey.set(key, { ...row, matchedConditions: [condition.id] });
      }
      if (apiRows.length < ROW_LIMIT) break;
      startRow += ROW_LIMIT;
    }
    conditionCounts[condition.id] = fetchedForCondition;
  }
  const rows = [...rowsByKey.values()].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
  const topImpressions = [...rows].sort((a, b) => b.impressions - a.impressions).slice(0, 50);
  const topClicks = [...rows].sort((a, b) => b.clicks - a.clicks).slice(0, 50);
  const position8to20 = rows.filter((r) => r.position >= 8 && r.position <= 20).sort((a, b) => b.impressions - a.impressions).slice(0, 50);
  const ctrImprove = rows.filter((r) => r.impressions >= 10).sort((a, b) => (a.ctr - b.ctr) || (b.impressions - a.impressions)).slice(0, 50);
  const pageMap = new Map();
  for (const r of rows) if (r.page) { const e = pageMap.get(r.page) || { page: r.page, queries: [], impressions: 0, clicks: 0 }; e.queries.push(r.query); e.impressions += r.impressions; e.clicks += r.clicks; pageMap.set(r.page, e); }
  const relatedPages = [...pageMap.values()].sort((a,b)=>b.impressions-a.impressions).slice(0,20);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "search-console-rows.json"), `${JSON.stringify({ targetKeyword, siteUrl, startDate, endDate, rows, views: { topImpressions, topClicks, position8to20, ctrImprove, relatedPages } }, null, 2)}\n`);
  const conditionSummaries = conditions.map((condition) => ({ condition: condition.id, groupType: "and", filters: condition.expressions.map((expression) => ({ dimension: "query", operator: "contains", expression })) }));
  const summary = { ok: true, apiName: "Google Search Console API", methodName: "searchconsole.searchanalytics.query", siteUrl, startDate, endDate, dimensions, dimensionFilterGroups: conditionSummaries, filters: conditionSummaries.flatMap((c) => c.filters.map((filter) => ({ condition: c.condition, groupType: c.groupType, ...filter }))), rowLimit: ROW_LIMIT, maxRows: MAX_ROWS, scope: SCOPE, apiCallCount: calls.length, conditionCounts, requests: calls.map((c)=>({ condition: c.condition, startDate: c.requestBody.startDate, endDate: c.requestBody.endDate, dimensions: c.requestBody.dimensions, dimensionFilterGroups: c.requestBody.dimensionFilterGroups, filters: c.requestBody.dimensionFilterGroups.flatMap((g) => g.filters), rowLimit: c.requestBody.rowLimit, startRow: c.requestBody.startRow })) };
  await writeFile(path.join(OUT_DIR, "request-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const md = `# Search Consoleデータ取得レポート\n\n## 取得概要\n\n- 対象キーワード: ${targetKeyword}\n- Search Consoleプロパティ: ${siteUrl}\n- 取得期間: ${startDate}〜${endDate}\n- APIメソッド: searchconsole.searchanalytics.query\n- dimensions: query, page\n- フィルター条件: query contains を条件A/B/CでAND指定\n- 総API呼び出し回数: ${calls.length}\n- 取得件数: ${rows.length}\n- 取得日時: ${new Date().toISOString()}\n\n## 取得条件A：厳密な検索意図\n\n- 150cc\n- バイク\n- おすすめ\n\n## 取得条件B：中程度の関連検索\n\n- 150cc\n- バイク\n\n## 取得条件C：広い関連検索\n\n- 150cc\n\n## 表示回数上位クエリ\n\n${table(topImpressions)}\n## クリック数上位クエリ\n\n${table(topClicks)}\n## 8〜20位の追記候補\n\n${table(position8to20)}\n## CTR改善候補\n\n${table(ctrImprove)}\n## 関連する既存ページ\n\n${relatedPages.length ? relatedPages.map((p)=>`- ${p.page}: ${p.queries.slice(0,5).join("、")}（clicks ${p.clicks} / impressions ${p.impressions}）`).join("\n") : "関連する既存ページは取得結果内にありません。"}\n\n## 注意事項\n\nSearch Consoleの値は、自サイトがGoogle検索に表示された実績であり、検索市場全体の検索ボリュームではありません。Search Console APIは内部制限や匿名化などにより全データ行の取得を保証しないため、取得行は利用可能な範囲の参考データとして扱います。取得結果が0件の場合も、存在しないSearch Consoleデータは生成・推測していません。\n`;
  await writeFile(path.join(OUT_DIR, "search-console.md"), md);
  console.log(`Search Console rows: ${rows.length}`);
}
main().catch(async (error) => { const message = error instanceof Error ? error.message : "Search Console取得に失敗しました。"; await writeFailure(message).catch(()=>{}); console.error(message); process.exit(1); });
