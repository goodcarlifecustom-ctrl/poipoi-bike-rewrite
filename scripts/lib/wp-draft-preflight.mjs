import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function normalizeRestRoot(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error("WP_REST_ROOT が空です。");
  if (/\/wp-json\/wp\/v2(?:\/|$)/i.test(trimmed)) {
    throw new Error("WP_REST_ROOT には /wp-json/wp/v2/ や投稿タイプまで含めず、WordPressルートまたは /wp-json/ までを指定してください。");
  }
  const withoutSlash = trimmed.replace(/\/+$/, "");
  if (withoutSlash.endsWith("/wp-json")) return `${withoutSlash}/`;
  return `${withoutSlash}/wp-json/`;
}

export function restRootFromApiUrl(apiUrl) {
  if (!apiUrl) return "";
  const url = new URL(apiUrl);
  const marker = "/wp-json/";
  const index = url.pathname.indexOf(marker);
  if (index === -1) return "";
  return `${url.origin}${url.pathname.slice(0, index + marker.length)}`;
}

export function safeUrlInfo(value) {
  const url = new URL(value);
  return { origin: url.origin, path: url.pathname };
}

export function endpointFor(restRoot, restBase) {
  return new URL(`wp/v2/${restBase}`, restRoot).toString();
}

export function extractSourceUrl(meta) {
  return meta?.source_url || meta?.url || meta?.link || "";
}

export function validateDraftTitle(title) {
  const normalized = String(title || "").replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("投稿タイトルが空です。");
  if (normalized === "リライト記事 下書き") throw new Error("投稿タイトルがフォールバック値のままです。");
  if (normalized.length < 10) throw new Error("投稿タイトルが短すぎるため投稿を停止します。");
  return normalized;
}

function sanitizeMessage(message) {
  return String(message || "").replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [REDACTED]");
}

async function fetchJson(fetchImpl, url, headers = {}) {
  try {
    const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json", ...headers } });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { response, text, json };
  } catch (fetchError) {
    if (fetchImpl !== fetch) throw fetchError;
    const args = ["--location", "--silent", "--show-error", "--max-time", "45", "--header", "accept: application/json", "--write-out", "\n%{http_code}", url];
    const { stdout } = await execFileAsync("curl", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    const marker = stdout.lastIndexOf("\n");
    const text = marker >= 0 ? stdout.slice(0, marker) : stdout;
    const status = marker >= 0 ? Number(stdout.slice(marker + 1)) : 0;
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { response: { ok: status >= 200 && status < 300, status }, text, json };
  }
}

function collectAvailableRestBases(typesJson) {
  if (!typesJson || typeof typesJson !== "object") return [];
  return Object.values(typesJson)
    .map((item) => item?.rest_base)
    .filter((value) => typeof value === "string" && value.trim())
    .sort();
}

function routeExists(rootJson, restBase) {
  const routes = rootJson?.routes;
  if (!routes || typeof routes !== "object") return false;
  const route = routes[`/wp/v2/${restBase}`];
  if (!route) return false;
  const endpoints = Array.isArray(route?.endpoints) ? route.endpoints : [];
  return endpoints.some((endpoint) => Array.isArray(endpoint?.methods) && endpoint.methods.includes("POST"));
}

async function writeReport(reportPath, report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function preflightWordPressDraft({ restRoot, postType, endpoint, sourceUrl, reportPath, fetchImpl = fetch }) {
  const baseReport = { ok: false, restRoot, postType, endpoint, httpStatus: null, wordpressErrorCode: null, message: "", availableRestBases: [] };
  try {
    const source = sourceUrl ? new URL(sourceUrl) : null;
    const root = new URL(restRoot);
    if (source && source.origin !== root.origin) {
      throw new Error(`対象記事URLのorigin (${source.origin}) と投稿先RESTルートのorigin (${root.origin}) が一致しません。`);
    }
    if (source && source.pathname.startsWith("/bike/") && !root.pathname.startsWith("/bike/")) {
      throw new Error("/bike/ 配下の記事をサイト直下のRESTルートへ投稿しないため停止しました。");
    }

    const rootResult = await fetchJson(fetchImpl, restRoot);
    baseReport.httpStatus = rootResult.response.status;
    baseReport.wordpressErrorCode = rootResult.json?.code || null;
    if (!rootResult.response.ok) {
      throw new Error(`REST APIルートが200系で応答しません: ${rootResult.response.status}`);
    }
    if (!rootResult.json?.namespaces?.includes("wp/v2")) {
      throw new Error("wp/v2 namespace が見つかりません。");
    }

    const typesUrl = new URL("wp/v2/types", restRoot).toString();
    const typesResult = await fetchJson(fetchImpl, typesUrl);
    baseReport.httpStatus = typesResult.response.status;
    baseReport.wordpressErrorCode = typesResult.json?.code || null;
    if (!typesResult.response.ok) {
      throw new Error(`wp/v2/types が取得できません: ${typesResult.response.status}`);
    }

    const availableRestBases = collectAvailableRestBases(typesResult.json);
    baseReport.availableRestBases = availableRestBases;
    const typeInfo = Object.values(typesResult.json || {}).find((item) => item?.rest_base === postType || item?.slug === postType);
    if (!typeInfo?.rest_base) {
      throw new Error(`WP_POST_TYPE に対応するREST baseが見つかりません: ${postType}`);
    }

    const restBase = typeInfo.rest_base;
    const expectedEndpoint = endpointFor(restRoot, restBase);
    if (endpoint !== expectedEndpoint) {
      throw new Error(`POST endpointが投稿タイプのREST baseと一致しません: ${endpoint}`);
    }
    if (!routeExists(rootResult.json, restBase)) {
      baseReport.httpStatus = 404;
      baseReport.wordpressErrorCode = "rest_no_route";
      throw new Error(`POST対象endpointのルートが見つかりません: wp/v2/${restBase}`);
    }

    const report = { ...baseReport, ok: true, httpStatus: 200, wordpressErrorCode: null, message: "プリフライトに成功しました。", availableRestBases };
    await writeReport(reportPath, report);
    return { ok: true, report, restBase };
  } catch (error) {
    const report = { ...baseReport, ok: false, message: sanitizeMessage(error.message), availableRestBases: baseReport.availableRestBases };
    await writeReport(reportPath, report);
    return { ok: false, report, restBase: null };
  }
}

export async function readMeta(metaPath) {
  try {
    const text = await readFile(metaPath, "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}
