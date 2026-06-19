#!/usr/bin/env node

import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { endpointFor, extractSourceUrl, normalizeRestRoot, preflightWordPressDraft, readMeta, restRootFromApiUrl, validateDraftTitle } from "./lib/wp-draft-preflight.mjs";

const execFileAsync = promisify(execFile);

const articleDir = process.argv[2] || process.env.ARTICLE_DIR || "articles/sample-article";
const rewrittenPath = path.join(articleDir, "rewritten.html");
const inputPath = path.join(articleDir, "input.md");
const metaPath = path.join(articleDir, "original.meta.json");
const outputPath = path.join(articleDir, "wordpress-draft.json");
const preflightPath = path.join(articleDir, "wp-rest-preflight.json");

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

function stripTags(value) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
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

  const h1Match = rewrittenHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1] && stripTags(h1Match[1])) return stripTags(h1Match[1]);

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

const content = await readFile(rewrittenPath, "utf8");
if (!content.trim()) throw new Error(`${rewrittenPath} が空です。`);

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

async function postJson(url, body, headers) {
  try {
    const response = await fetch(url, {
      method: "POST",
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
      await writeFile(bodyPath, body, "utf8");
      await writeFile(configPath, `${headerConfig}\n`, "utf8");
      try {
        const { stdout } = await execFileAsync("curl", [
          "--config",
          configPath,
          "--location",
          "--silent",
          "--show-error",
          "--max-time",
          "60",
          "--request",
          "POST",
          "--data-binary",
          `@${bodyPath}`,
          "--write-out",
          "\n%{http_code}",
          url,
        ], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
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

const response = await postJson(postEndpoint, JSON.stringify({ title, content, status }), {
  authorization: buildAuthHeader(username, applicationPassword),
  "content-type": "application/json",
  accept: "application/json",
});

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
  createdAt: new Date().toISOString(),
  postType,
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
console.log(`下書きID: ${draft.id}`);
console.log(`編集URL: ${draft.editUrl}`);
if (draft.previewUrl) console.log(`プレビューURL: ${draft.previewUrl}`);
