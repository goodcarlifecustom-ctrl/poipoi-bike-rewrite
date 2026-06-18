#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const articleDir = process.env.ARTICLE_DIR || "articles/sample-article";
const isNewArticle = articleDir !== "articles/sample-article";
const contentPath = path.join(articleDir, isNewArticle ? "article.html" : "rewritten.html");
const metadataPath = path.join(articleDir, "metadata.json");
const legacyInputPath = path.join(articleDir, "input.md");
const legacyMetaPath = path.join(articleDir, "original.meta.json");
const outputPath = path.join(articleDir, isNewArticle ? "wordpress-draft-result.json" : "wordpress-draft.json");
const FIXED_STATUS = "draft";
const dryRun = process.env.WP_DRY_RUN === "1";
const dryRunScenario = process.env.WP_DRY_RUN_SCENARIO || "none";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} が設定されていません。`);
  return value.trim();
}
function normalizeBaseUrl(value) { return value.trim().replace(/\/+$/, ""); }
function baseUrlFromEnv() { return normalizeBaseUrl(process.env.WP_BASE_URL || process.env.WP_REST_ROOT?.replace(/\/wp-json\/?$/, "") || requiredEnv("WP_BASE_URL")); }
function restRoot(baseUrl) { return `${normalizeBaseUrl(baseUrl)}/wp-json/`; }
function authHeader(username, password) { return `Basic ${Buffer.from(`${username}:${password.replace(/\s+/g, "")}`, "utf8").toString("base64")}`; }
function stripTags(value) { return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
function editUrl(baseUrl, postId) { return `${normalizeBaseUrl(baseUrl)}/wp-admin/post.php?post=${postId}&action=edit`; }
async function readOptional(file) { try { return await readFile(file, "utf8"); } catch (error) { if (error.code === "ENOENT") return ""; throw error; } }
async function readJson(file) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return {}; } }
async function getTitle(content, metadata) {
  if (metadata.title && stripTags(metadata.title)) return stripTags(metadata.title);
  const input = await readOptional(legacyInputPath);
  const titleMatch = input.match(/^記事タイトル：\s*(.+)$/m);
  if (titleMatch?.[1]?.trim()) return titleMatch[1].trim();
  const legacyMetaText = await readOptional(legacyMetaPath);
  if (legacyMetaText.trim()) {
    try { const legacyMeta = JSON.parse(legacyMetaText); if (stripTags(legacyMeta.title)) return stripTags(legacyMeta.title); } catch {}
  }
  return stripTags(content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || "下書き記事";
}
function fakePost(id, status, slug, title) { return { id, status, slug, title: { rendered: title }, date: "2026-06-18T00:00:00", modified: "2026-06-18T00:00:00", link: `${process.env.WP_BASE_URL || "https://example.com"}/${slug}/` }; }
async function wpFetch(url, options, context) {
  if (dryRun) {
    if (context === "search") {
      if (dryRunScenario === "published") return [fakePost(101, "publish", options.slug, options.title)];
      if (dryRunScenario === "draft") return [fakePost(102, "draft", options.slug, options.title)];
      return [];
    }
    if (context === "write") return fakePost(options.id || 201, FIXED_STATUS, options.slug, options.title);
    if (context === "verify") return fakePost(options.id || 201, process.env.WP_DRY_RUN_VERIFY_STATUS || FIXED_STATUS, options.slug, options.title);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { message: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(`WordPress REST API error: ${res.status} ${res.statusText} ${json.code || json.message || ""}`.trim());
  return json;
}

async function main() {
  const baseUrl = baseUrlFromEnv();
  const username = dryRun ? (process.env.WP_USERNAME || "dry-run-user") : requiredEnv("WP_USERNAME");
  const password = dryRun ? (process.env.WP_APPLICATION_PASSWORD || "dry-run-password") : requiredEnv("WP_APPLICATION_PASSWORD");
  const content = await readFile(contentPath, "utf8");
  if (!content.trim()) throw new Error(`${contentPath} が空です。`);
  if (isNewArticle && /<h1\b/i.test(content)) throw new Error("新規記事のarticle.htmlにh1が含まれています。WordPress投稿タイトルとの重複を避けるため停止します。");
  const metadata = await readJson(metadataPath);
  const title = await getTitle(content, metadata);
  const slug = metadata.slug || path.basename(articleDir);
  const excerpt = metadata.excerpt || metadata.metaDescription || "";
  const categories = Array.isArray(metadata.categories) && metadata.categories.length ? metadata.categories : undefined;
  const root = restRoot(baseUrl);
  const postType = (process.env.WP_POST_TYPE || "posts").trim() || "posts";
  const headers = { authorization: authHeader(username, password), "content-type": "application/json", accept: "application/json" };
  const endpoint = new URL(`wp/v2/${postType}`, root);

  const searchUrl = new URL(endpoint);
  searchUrl.searchParams.set("slug", slug);
  searchUrl.searchParams.set("status", "any");
  searchUrl.searchParams.set("_fields", "id,status,slug,title,date,modified,link");
  const existing = await wpFetch(searchUrl, { headers, slug, title }, "search");
  const sameSlug = Array.isArray(existing) ? existing.find((p) => p.slug === slug) : null;
  if (sameSlug && sameSlug.status === "publish") throw new Error(`同じslugの公開済み記事が存在するため停止しました: postId ${sameSlug.id}`);

  const payload = { title, slug, content, excerpt, status: FIXED_STATUS, ...(categories ? { categories } : {}) };
  let action = "created";
  let post;
  if (sameSlug) {
    action = "updated";
    post = await wpFetch(new URL(`wp/v2/${postType}/${sameSlug.id}`, root), { method: "POST", headers, body: JSON.stringify(payload), id: sameSlug.id, slug, title }, "write");
  } else {
    post = await wpFetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload), slug, title }, "write");
  }
  const verify = await wpFetch(new URL(`wp/v2/${postType}/${post.id}?_fields=id,status,slug,title,date,modified,link`, root), { headers, id: post.id, slug, title }, "verify");
  if (verify.status !== FIXED_STATUS) throw new Error(`WordPress投稿ステータスがdraftではありません: ${verify.status}`);
  const result = { postId: verify.id, status: verify.status, slug: verify.slug, title: stripTags(verify.title?.rendered || title), action, dryRun, [action === "created" ? "createdAt" : "updatedAt"]: action === "created" ? verify.date : verify.modified, editUrl: editUrl(baseUrl, verify.id) };
  await mkdir(articleDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`WordPress下書き結果を保存しました: ${outputPath}`);
  console.log(`下書きID: ${result.postId}`);
  console.log(`ステータス: ${result.status}`);
  console.log(`編集URL: ${result.editUrl}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "WordPress下書き作成に失敗しました。";
  console.error(message);
  process.exit(1);
});
