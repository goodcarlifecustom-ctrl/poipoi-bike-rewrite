#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_OUTPUT_PATH = "articles/sample-article/gsc-keyword-data.json";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} が設定されていません。GitHub Secrets/Variables または環境変数に設定してください。`);
  }
  return value.trim();
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function defaultDateRange() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function positiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${value} は正の整数ではありません。`);
  }
  return parsed;
}

function parseServiceAccount(jsonText) {
  try {
    const credentials = JSON.parse(jsonText);
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("client_email/private_key が見つかりません。");
    }
    return credentials;
  } catch (error) {
    throw new Error(`GSC_SERVICE_ACCOUNT_JSON をJSONとして読み取れません: ${error.message}`);
  }
}

function sanitizeRows(rows = []) {
  return rows.map((row) => {
    const [query = "", page = ""] = row.keys || [];
    return {
      query,
      page,
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
    };
  });
}

const range = defaultDateRange();
const startDate = argValue("start-date") || process.env.GSC_START_DATE || range.startDate;
const endDate = argValue("end-date") || process.env.GSC_END_DATE || range.endDate;
const rowLimit = positiveInteger(argValue("row-limit") || process.env.GSC_ROW_LIMIT, 25000);
const outputPath = argValue("output") || process.env.GSC_OUTPUT_PATH || DEFAULT_OUTPUT_PATH;
const siteUrl = requiredEnv("GSC_SITE_URL");
const credentials = parseServiceAccount(requiredEnv("GSC_SERVICE_ACCOUNT_JSON"));

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: [SEARCH_CONSOLE_SCOPE],
});

const searchconsole = google.searchconsole({ version: "v1", auth });
const response = await searchconsole.searchanalytics.query({
  siteUrl,
  requestBody: {
    startDate,
    endDate,
    dimensions: ["query", "page"],
    rowLimit,
  },
});

const payload = {
  siteUrl,
  startDate,
  endDate,
  dimensions: ["query", "page"],
  rowCount: response.data.rows?.length || 0,
  rows: sanitizeRows(response.data.rows || []),
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`GSC keyword data saved: ${outputPath} (${payload.rowCount} rows)`);
