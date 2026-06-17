#!/usr/bin/env node

/**
 * URLから元記事HTMLを取得して articles/sample-article/original.html に保存する補助スクリプト。
 *
 * WordPressのアプリケーションパスワードが .env に設定されている場合は、
 * WordPress REST APIへ認証付きでアクセスして本文HTMLを取得する。
 *
 * 既存の prompt.md / rules / rewrite-plan.md / rewritten.html は一切変更しない。
 *
 * 使い方:
 * node scripts/import-original-from-url.mjs "https://poi-poi.co.jp/bike/"
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function loadEnv(filePath = ".env") {
  try {
    const text = await readFile(filePath, "utf8");

    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      value = value.replace(/^["']|["']$/g, "");

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function getWpAuthHeaders() {
  const username = process.env.WP_USERNAME || "";
  const appPassword = (process.env.WP_APPLICATION_PASSWORD || "").replace(/\s+/g, "");

  if (!username || !appPassword) return {};

  const token = Buffer.from(`${username}:${appPassword}`, "utf8").toString("base64");

  return {
    authorization: `Basic ${token}`,
  };
}

function hasWpAuth() {
  return Boolean(
    process.env.WP_USERNAME &&
      process.env.WP_APPLICATION_PASSWORD &&
      process.env.WP_APPLICATION_PASSWORD.trim()
  );
}

function getPostTypes() {
  return (process.env.WP_POST_TYPES || "posts,pages")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getMinHtmlLength() {
  const value = Number(process.env.MIN_HTML_LENGTH || 500);
  return Number.isFinite(value) && value > 0 ? value : 500;
}

function pickContent(item) {
  const mode = (process.env.WP_CONTENT_MODE || "rendered").toLowerCase();

  const raw = item?.content?.raw;
  const rendered = item?.content?.rendered;

  const candidates = mode === "raw" ? [raw, rendered] : [rendered, raw];

  const content = candidates.find(
    (value) => typeof value === "string" && value.trim().length > 0
  );

  return content ? content.trim() : "";
}

function pickTitle(item) {
  return item?.title?.raw || item?.title?.rendered || "";
}

function getRequestVariants(useAuth) {
  if (!useAuth) {
    return [
      {
        context: "view",
      },
    ];
  }

  return [
    {
      context: "edit",
      status: "any",
    },
    {
      context: "edit",
    },
    {
      context: "view",
    },
  ];
}

await loadEnv();

const sourceUrl = process.argv[2];
const outputPath = process.argv[3] || "articles/sample-article/original.html";

if (!sourceUrl) {
  console.error("URLを指定してください。");
  console.error(
    '例: node scripts/import-original-from-url.mjs "https://poi-poi.co.jp/bike/"'
  );
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(sourceUrl);
} catch {
  console.error(`URLの形式が正しくありません: ${sourceUrl}`);
  process.exit(1);
}

const userAgent =
  "Mozilla/5.0 (compatible; ArticleImporter/1.0; +https://poi-poi.co.jp/bike/)";

async function fetchText(url, accept = "text/html", extraHeaders = {}) {
  const headers = {
    "user-agent": userAgent,
    accept,
    ...extraHeaders,
  };

  try {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(`取得に失敗しました: ${res.status} ${res.statusText} - ${url}`);
    }

    return await res.text();
  } catch (fetchError) {
    const args = ["--fail", "--location", "--silent", "--show-error", "--max-time", "45"];

    for (const [name, value] of Object.entries(headers)) {
      if (!value || name.toLowerCase() === "authorization") continue;
      args.push("--header", `${name}: ${value}`);
    }

    args.push(url);

    try {
      const { stdout } = await execFileAsync("curl", args, {
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
      });
      return stdout;
    } catch {
      throw fetchError;
    }
  }
}

async function fetchJson(url, extraHeaders = {}) {
  const text = await fetchText(url, "application/json", extraHeaders);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSONの解析に失敗しました: ${url}`);
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function decodeHtmlEntities(str) {
  return str
    .replaceAll("&amp;", "&")
    .replaceAll("&#038;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function getSlugFromUrl(urlObj) {
  const parts = urlObj.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  const slug = last.replace(/\.html?$/i, "");

  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function normalizeRestRoot(url) {
  if (!url) return "";

  const trimmed = url.trim();
  if (!trimmed) return "";

  if (/\/wp-json\/?$/i.test(trimmed)) {
    return trimmed.replace(/\/?$/, "/");
  }

  return trimmed.replace(/\/?$/, "/") + "wp-json/";
}

function getConfiguredRestRoots() {
  return (process.env.WP_REST_ROOT || "")
    .split(",")
    .map(normalizeRestRoot)
    .filter(Boolean);
}

function getRestCandidates(pageHtml, urlObj) {
  const candidates = [];

  candidates.push(...getConfiguredRestRoots());

  if (pageHtml) {
    const relApiRegex =
      /<link[^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]+href=["']([^"']+)["'][^>]*>/gi;

    let match;
    while ((match = relApiRegex.exec(pageHtml)) !== null) {
      candidates.push(decodeHtmlEntities(match[1]));
    }

    const relApiRegexReverse =
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]*>/gi;

    while ((match = relApiRegexReverse.exec(pageHtml)) !== null) {
      candidates.push(decodeHtmlEntities(match[1]));
    }
  }

  const pathParts = urlObj.pathname.split("/").filter(Boolean);

  candidates.push(`${urlObj.origin}/wp-json/`);

  if (pathParts.length > 0) {
    candidates.push(`${urlObj.origin}/${pathParts[0]}/wp-json/`);
  }

  return unique(candidates.map(normalizeRestRoot));
}

async function tryFetchWordPressContent(pageHtml, urlObj) {
  const slug = getSlugFromUrl(urlObj);
  if (!slug) return null;

  const restCandidates = getRestCandidates(pageHtml, urlObj);
  const postTypes = getPostTypes();
  const authHeaders = getWpAuthHeaders();
  const useAuth = hasWpAuth();
  const minHtmlLength = getMinHtmlLength();

  for (const restRoot of restCandidates) {
    for (const postType of postTypes) {
      for (const variant of getRequestVariants(useAuth)) {
        const params = new URLSearchParams({
          slug,
          _fields: "id,slug,link,title,content,status,type",
        });

        for (const [key, value] of Object.entries(variant)) {
          params.set(key, value);
        }

        const apiUrl = `${restRoot}wp/v2/${postType}?${params.toString()}`;

        try {
          const items = await fetchJson(apiUrl, useAuth ? authHeaders : {});

          if (!Array.isArray(items) || !items[0]) continue;

          const html = pickContent(items[0]);

          if (html && html.length > minHtmlLength) {
            return {
              html,
              sourceType: useAuth
                ? `wordpress-rest-auth:${postType}`
                : `wordpress-rest-public:${postType}`,
              apiUrl,
              title: pickTitle(items[0]),
            };
          }
        } catch {
          // REST APIが無効・権限不足・URL違いの場合は次の候補へ進む
        }
      }
    }
  }

  return null;
}

function removeNoise(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function sliceElementByOpeningMatch(html, openingMatch) {
  const fullOpeningTag = openingMatch[0];
  const tagName = openingMatch[1].toLowerCase();
  const startIndex = openingMatch.index;
  const afterOpeningIndex = startIndex + fullOpeningTag.length;

  const tagRegex = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tagRegex.lastIndex = afterOpeningIndex;

  let depth = 1;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[0];

    if (tag.startsWith(`</`)) {
      depth -= 1;
    } else if (!tag.endsWith("/>")) {
      depth += 1;
    }

    if (depth === 0) {
      return html.slice(startIndex, tagRegex.lastIndex);
    }
  }

  return "";
}

function extractElementByClass(html, className) {
  const regex = new RegExp(
    `<([a-z0-9]+)\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>`,
    "i"
  );

  const match = regex.exec(html);
  if (!match) return "";

  return sliceElementByOpeningMatch(html, match);
}

function extractElementByTag(html, tagName) {
  const regex = new RegExp(`<(${tagName})\\b[^>]*>`, "i");
  const match = regex.exec(html);
  if (!match) return "";

  return sliceElementByOpeningMatch(html, match);
}

function extractMainContent(pageHtml) {
  const cleaned = removeNoise(pageHtml);
  const minHtmlLength = getMinHtmlLength();

  const candidates = [
    extractElementByClass(cleaned, "post_content"),
    extractElementByClass(cleaned, "entry-content"),
    extractElementByClass(cleaned, "p-entry__content"),
    extractElementByClass(cleaned, "articleBody"),
    extractElementByClass(cleaned, "article-body"),
    extractElementByClass(cleaned, "main_content"),
    extractElementByTag(cleaned, "article"),
    extractElementByTag(cleaned, "main"),
  ].filter((html) => html && html.trim().length > minHtmlLength);

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.length - a.length);
    return {
      html: candidates[0].trim(),
      sourceType: "public-html-extract",
      apiUrl: "",
      title: "",
    };
  }

  return {
    html: cleaned.trim(),
    sourceType: "full-public-html",
    apiUrl: "",
    title: "",
  };
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "-",
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("");
}

async function backupIfNeeded(filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) return null;

    const current = await readFile(filePath, "utf8");
    if (!current.trim()) return null;

    const parsed = path.parse(filePath);
    const backupPath = path.join(
      parsed.dir,
      `${parsed.name}.backup-${timestamp()}${parsed.ext}`
    );

    await writeFile(backupPath, current, "utf8");
    return backupPath;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`取得URL: ${sourceUrl}`);

  if (hasWpAuth()) {
    console.log("WordPress認証: 有効");
  } else {
    console.log("WordPress認証: なし。公開REST APIまたは公開HTMLで取得します。");
  }

  let pageHtml = "";
  let pageFetchError = null;

  try {
    pageHtml = await fetchText(sourceUrl);
  } catch (error) {
    pageFetchError = error;
    console.warn("公開HTMLの取得に失敗しました。WordPress REST APIでの取得を試します。");
  }

  const wpContent = await tryFetchWordPressContent(pageHtml, parsedUrl);

  let result;

  if (wpContent) {
    result = wpContent;
  } else if (pageHtml) {
    result = extractMainContent(pageHtml);
  } else {
    throw pageFetchError || new Error("公開HTMLもWordPress REST APIも取得できませんでした。");
  }

  if (!result.html || result.html.trim().length < getMinHtmlLength()) {
    throw new Error("取得したHTMLが短すぎます。URLまたは抽出結果を確認してください。");
  }

  await ensureDir(path.dirname(outputPath));

  const backupPath = await backupIfNeeded(outputPath);

  await writeFile(outputPath, result.html.trim() + "\n", "utf8");

  const metaPath = path.join(path.dirname(outputPath), "original.meta.json");

  const meta = {
    source_url: sourceUrl,
    output_path: outputPath,
    saved_at: new Date().toISOString(),
    source_type: result.sourceType,
    api_url: result.apiUrl || "",
    title: result.title || "",
    character_count: result.html.length,
    backup_path: backupPath || "",
  };

  await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");

  console.log("保存完了:");
  console.log(`- ${outputPath}`);
  console.log(`- ${metaPath}`);

  if (backupPath) {
    console.log(`バックアップ作成: ${backupPath}`);
  }

  console.log(`取得方式: ${result.sourceType}`);
  console.log(`文字数: ${result.html.length}`);
}

main().catch((error) => {
  console.error("エラー:");
  console.error(error.message);
  process.exit(1);
});
