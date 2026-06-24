#!/usr/bin/env node

import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { endpointFor, extractSourceUrl, normalizeRestRoot, preflightWordPressDraft, readMeta, restRootFromApiUrl, validateDraftTitle } from "./lib/wp-draft-preflight.mjs";
import { stripArticleFrontMatter, validateGutenbergBlocks } from "./lib/gutenberg-blocks.mjs";

const execFileAsync = promisify(execFile);

const articleDir = process.argv[2] || process.env.ARTICLE_DIR || "articles/sample-article";
const rewrittenPath = path.join(articleDir, "rewritten.html");
const inputPath = path.join(articleDir, "input.md");
const metaPath = path.join(articleDir, "original.meta.json");
const outputPath = path.join(articleDir, "wordpress-draft.json");
const preflightPath = path.join(articleDir, "wp-rest-preflight.json");
const verificationPath = path.join(articleDir, "wordpress-draft-verification.json");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} が設定されていません。Codex Cloudの環境変数に設定してください。`);
  }
  return value.trim();
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function readJsonOptional(filePath) {
  const text = await readOptional(filePath);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function normalizeHeadingText(value) {
  return stripTags(value)
    .replace(/[【】「」『』（）()［］\[\]〈〉《》]/g, "")
    .replace(/[｜|:：・,，、。.!！?？\-ー〜～\s]/g, "")
    .toLowerCase();
}

function similarity(a, b) {
  const left = normalizeHeadingText(a);
  const right = normalizeHeadingText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.72) return shorter.length / longer.length;
  const set = new Set(shorter);
  let common = 0;
  for (const ch of longer) {
    if (set.has(ch)) common += 1;
  }
  return common / longer.length;
}

function firstHeadingText(html) {
  const match = String(html || "").match(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i);
  return match ? stripTags(match[2]) : "";
}

function validateContentForDraft(content, title) {
  const h1Matches = String(content || "").match(/<h1\b/gi) || [];
  if (h1Matches.length > 0) {
    throw new Error(`WordPress送信予定のcontent.rawに<h1>が${h1Matches.length}件含まれているため投稿を停止します。`);
  }

  const heading = firstHeadingText(content);
  if (heading && title && similarity(heading, title) >= 0.9) {
    throw new Error(`本文冒頭の最初の見出しが投稿タイトルと同一またはほぼ同じため投稿を停止します: ${heading}`);
  }
}

function slugFromMeta(meta) {
  if (typeof meta?.slug === "string" && meta.slug.trim()) return meta.slug.trim();
  const source = extractSourceUrl(meta);
  if (!source) return "";
  try {
    const url = new URL(source);
    const last = url.pathname.replace(/\/+$/, "").split("/").pop() || "";
    return last.replace(/\.html?$/i, "");
  } catch {
    return "";
  }
}

async function getTitle(rewrittenHtml) {
  const input = await readOptional(inputPath);
  const titleMatch = input.match(/^記事タイトル：\s*(.+)$/m);
  if (titleMatch?.[1]?.trim()) return titleMatch[1].trim();

  const metaText = await readOptional(metaPath);
  if (metaText.trim()) {
    try {
      const meta = JSON.parse(metaText);
      if (typeof meta.title === "string" && stripTags(meta.title)) return stripTags(meta.title);
    } catch {
      // タイトル取得に失敗した場合は次の候補を使う。
    }
  }

  return "リライト記事 下書き";
}

function buildAuthHeader(username, applicationPassword) {
  const password = applicationPassword.replace(/\s+/g, "");
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function buildEditUrl(restRoot, post) {
  if (post.link) {
    try {
      const url = new URL(post.link);
      return `${url.origin}/wp-admin/post.php?post=${post.id}&action=edit`;
    } catch {
      // RESTルートから推定する。
    }
  }

  const root = new URL(restRoot);
  return `${root.origin}/wp-admin/post.php?post=${post.id}&action=edit`;
}

const finalize = spawnSync(process.execPath, [path.resolve("scripts/finalize-article.mjs"), articleDir], { encoding: "utf8" });
if (finalize.status !== 0) {
  throw new Error(`記事の完成処理がFAILのためWordPress下書き作成を停止しました: ${finalize.stderr || finalize.stdout}`);
}

const content = stripArticleFrontMatter(await readFile(rewrittenPath, "utf8"));
if (!content.trim()) throw new Error(`${rewrittenPath} が空です。`);
const gutenbergValidation = validateGutenbergBlocks(content);
if (!gutenbergValidation.ok) {
  throw new Error(`WordPress送信予定のcontent.rawがGutenberg形式として不正です: ${gutenbergValidation.errors.join("; ")}`);
}

const username = requiredEnv("WP_USERNAME");
const applicationPassword = requiredEnv("WP_APPLICATION_PASSWORD");
const meta = await readMeta(metaPath);
let configuredRestRoot = "";
try {
  configuredRestRoot = normalizeRestRoot(requiredEnv("WP_REST_ROOT"));
} catch (error) {
  const metaRestRoot = restRootFromApiUrl(meta.api_url || meta.apiUrl || "");
  if (!metaRestRoot) throw error;
  configuredRestRoot = metaRestRoot;
}
const metaRestRoot = restRootFromApiUrl(meta.api_url || meta.apiUrl || "");
const restRoot = metaRestRoot || configuredRestRoot;
const postType = (process.env.WP_POST_TYPE || "posts").trim() || "posts";
const status = (process.env.WP_DRAFT_STATUS || "draft").trim() || "draft";

if (!/^draft|pending|private$/i.test(status)) {
  throw new Error("WP_DRAFT_STATUS は draft / pending / private のいずれかを指定してください。公開ステータスでは投稿しません。");
}

const title = validateDraftTitle(await getTitle(content));
validateContentForDraft(content, title);
const endpoint = endpointFor(restRoot, postType);
const preflight = await preflightWordPressDraft({
  restRoot,
  postType,
  endpoint,
  sourceUrl: extractSourceUrl(meta),
  reportPath: preflightPath,
});
if (!preflight.ok) {
  throw new Error(`WordPress RESTプリフライトに失敗したため投稿を停止しました: ${preflight.report.message}`);
}
const postEndpoint = endpointFor(restRoot, preflight.restBase);

async function requestJson(method, url, body, headers) {
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
    });
    return { ok: response.ok, status: response.status, statusText: response.statusText, text: await response.text() };
  } catch (fetchError) {
    try {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-draft-"));
      const bodyPath = path.join(tempDir, "body.json");
      const configPath = path.join(tempDir, "curl.conf");
      const headerConfig = Object.entries(headers)
        .map(([name, value]) => `header = "${String(`${name}: ${value}`).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
        .join("\n");
      await writeFile(bodyPath, body || "", "utf8");
      await writeFile(configPath, `${headerConfig}\n`, "utf8");
      try {
        const args = [
          "--config",
          configPath,
          "--location",
          "--silent",
          "--show-error",
          "--max-time",
          "60",
          "--request",
          method,
        ];
        if (body !== undefined) args.push("--data-binary", `@${bodyPath}`);
        args.push("--write-out", "\n%{http_code}", url);
        const { stdout } = await execFileAsync("curl", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
        const marker = stdout.lastIndexOf("\n");
        const text = marker >= 0 ? stdout.slice(0, marker) : stdout;
        const statusCode = marker >= 0 ? Number(stdout.slice(marker + 1)) : 0;
        return { ok: statusCode >= 200 && statusCode < 300, status: statusCode, statusText: "", text };
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    } catch {
      throw fetchError;
    }
  }
}

async function postJson(url, body, headers) {
  return requestJson("POST", url, body, headers);
}

async function putJson(url, body, headers) {
  return requestJson("PUT", url, body, headers);
}

async function getJson(url, headers) {
  const result = await requestJson("GET", url, undefined, headers);
  let json = null;
  try { json = result.text ? JSON.parse(result.text) : null; } catch { json = null; }
  return { ...result, json };
}

async function fetchPostById(endpoint, id, headers) {
  if (!id) return null;
  const url = new URL(`./${id}`, `${endpoint.replace(/\/+$/, "")}/`);
  url.searchParams.set("context", "edit");
  const result = await getJson(url.toString(), headers);
  if (!result.ok || !result.json) return null;
  const post = result.json;
  return ["draft", "pending", "private"].includes(String(post?.status || "").toLowerCase()) ? post : null;
}

async function findExistingEditableDraft(endpoint, slug, headers) {
  const candidates = [];
  const currentOutput = await readJsonOptional(outputPath);
  const verification = await readJsonOptional(verificationPath);
  if (currentOutput?.id) candidates.push(currentOutput.id);
  if (verification?.draftId) candidates.push(verification.draftId);
  for (const id of [...new Set(candidates)]) {
    const post = await fetchPostById(endpoint, id, headers);
    if (post) return post;
  }

  if (!slug) return null;
  for (const draftStatus of ["draft", "pending", "private"]) {
    const url = new URL(endpoint);
    url.searchParams.set("slug", slug);
    url.searchParams.set("status", draftStatus);
    url.searchParams.set("context", "edit");
    url.searchParams.set("per_page", "10");
    const result = await getJson(url.toString(), headers);
    if (!result.ok || !Array.isArray(result.json)) continue;
    const found = result.json.find((post) => ["draft", "pending", "private"].includes(String(post?.status || "").toLowerCase()));
    if (found) return found;
  }
  return null;
}

const authHeaders = {
  authorization: buildAuthHeader(username, applicationPassword),
  "content-type": "application/json",
  accept: "application/json",
};
const existingDraft = await findExistingEditableDraft(postEndpoint, slugFromMeta(meta), authHeaders);
const payload = JSON.stringify({ title, content, status });
const response = existingDraft
  ? await putJson(new URL(`./${existingDraft.id}`, `${postEndpoint.replace(/\/+$/, "")}/`).toString(), payload, authHeaders)
  : await postJson(postEndpoint, payload, authHeaders);
const operation = existingDraft ? "updated" : "created";

const responseText = response.text;
let responseJson;
try {
  responseJson = JSON.parse(responseText);
} catch {
  responseJson = { raw: responseText };
}

if (!response.ok) {
  await mkdir(articleDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ ok: false, status: response.status, statusText: response.statusText, error: responseJson }, null, 2)}\n`, "utf8");
  throw new Error(`WordPress下書き作成に失敗しました: ${response.status} ${response.statusText}`);
}

const draft = {
  ok: true,
  operation,
  updatedExistingDraft: Boolean(existingDraft),
  createdAt: new Date().toISOString(),
  postType,
  slug: responseJson.slug || existingDraft?.slug || slugFromMeta(meta) || null,
  status: responseJson.status || status,
  id: responseJson.id,
  title,
  editUrl: buildEditUrl(restRoot, responseJson),
  link: responseJson.link || null,
  previewUrl: responseJson.preview_link || responseJson.guid?.rendered || responseJson.link || null,
};

await mkdir(articleDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
console.log(`WordPress下書き結果を保存しました: ${outputPath}`);
console.log(`処理種別: ${draft.operation}`);
console.log(`下書きID: ${draft.id}`);
console.log(`編集URL: ${draft.editUrl}`);
if (draft.previewUrl) console.log(`プレビューURL: ${draft.previewUrl}`);
