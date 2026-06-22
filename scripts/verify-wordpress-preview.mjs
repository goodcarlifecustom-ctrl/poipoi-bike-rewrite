#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as parse5 from "parse5";

const execFileAsync = promisify(execFile);

const articleDir = process.argv[2] || process.env.ARTICLE_DIR || "articles/sample-article";
const draftPath = path.join(articleDir, "wordpress-draft.json");
const validationPath = path.join(articleDir, "validation-result.json");
const restVerificationPath = path.join(articleDir, "wordpress-draft-verification.json");
const reportPath = path.join(articleDir, "wordpress-preview-render-verification.json");
const authRequiredCode = "INCONCLUSIVE_AUTH_REQUIRED";
const manualReason = "authenticated WordPress preview session unavailable";

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function textContent(node) {
  if (!node) return "";
  if (node.nodeName === "#text") return node.value || "";
  return (node.childNodes || []).map(textContent).join("");
}

function attr(node, name) {
  return node?.attrs?.find((item) => item.name === name)?.value || "";
}

function elementSummary(node) {
  if (!node) return null;
  return {
    tag: node.tagName || node.nodeName,
    id: attr(node, "id") || null,
    class: attr(node, "class") || null,
    role: attr(node, "role") || null,
    dataAttributes: Object.fromEntries((node.attrs || []).filter((item) => item.name.startsWith("data-")).map((item) => [item.name, item.value])),
  };
}

function walk(node, callback, parent = null) {
  callback(node, parent);
  for (const child of node.childNodes || []) walk(child, callback, node);
}

function normalizeTitleLikeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[【】「」『』（）()［］\[\]〈〉《》]/g, "")
    .replace(/[｜|:：・,，、。.!！?？\-ー〜～\s]/g, "")
    .toLowerCase()
    .trim();
}

function titleSimilarity(a, b) {
  const left = normalizeTitleLikeText(a);
  const right = normalizeTitleLikeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.72) return shorter.length / longer.length;
  const set = new Set(shorter);
  let common = 0;
  for (const ch of longer) if (set.has(ch)) common += 1;
  return common / longer.length;
}

function classifyTitleLikeElement(node, parent, title) {
  const tag = node.tagName || "";
  const text = textContent(node).replace(/\s+/g, " ").trim();
  if (!text) return null;
  const className = attr(node, "class");
  const similarity = titleSimilarity(text, title);
  const titleishClass = /title|ttl|headline|entry|post/i.test(className);
  const titleishTag = /^h[1-6]$/.test(tag);
  const strongTitleishParagraph = tag === "p" && /<(strong|b)\b/i.test(parse5.serialize(node)) && similarity >= 0.72;
  const titleishDiv = ["div", "section", "header"].includes(tag) && titleishClass && similarity >= 0.72;
  if (!titleishTag && !strongTitleishParagraph && !titleishDiv && similarity < 0.9) return null;
  return {
    text,
    similarity: Number(similarity.toFixed(3)),
    element: elementSummary(node),
    parent: elementSummary(parent),
  };
}

function sanitizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/nonce|token|key|password|pass|auth|cookie|session/i.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return "[INVALID_URL]";
  }
}

function hasPreviewTrue(value) {
  try {
    return new URL(value).searchParams.get("preview") === "true";
  } catch {
    return false;
  }
}

function baseReport({ draft, codeValidation, restApiValidation, previewUrl, status = authRequiredCode, reason = manualReason }) {
  return {
    status,
    codeValidation,
    restApiValidation,
    visualRenderValidation: "pending_manual",
    reason,
    checkedAt: new Date().toISOString(),
    draftId: draft?.id || null,
    expectedTitle: draft?.title || null,
    previewUrl: sanitizeUrl(previewUrl),
    httpStatus: null,
    finalUrl: null,
    pageLooksLikeDraft: false,
    titleCount: null,
    matchingTitleElements: [],
    headings: [],
    forbiddenPhrasePresent: null,
    message: "WP_PREVIEW_URLにログイン済みセッションで取得したpreview=true付きURLを指定して手動目視確認してください。認証情報、Cookie、nonceは保存しません。",
  };
}

async function fetchPreview(url) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 PoipoiPreviewVerifier/1.0",
      },
      redirect: "follow",
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      html: await response.text(),
    };
  } catch (fetchError) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-preview-"));
    const bodyPath = path.join(tempDir, "preview.html");
    try {
      const { stdout } = await execFileAsync("curl", [
        "--location",
        "--silent",
        "--show-error",
        "--max-time",
        "60",
        "--user-agent",
        "Mozilla/5.0 PoipoiPreviewVerifier/1.0",
        "--output",
        bodyPath,
        "--write-out",
        "%{http_code}\n%{url_effective}",
        url,
      ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
      const [statusLine, ...urlLines] = stdout.trim().split("\n");
      const status = Number(statusLine) || 0;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: "",
        finalUrl: urlLines.join("\n") || url,
        html: await readFile(bodyPath, "utf8"),
        fetchFallback: fetchError.message,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

function isAuthOrNotFoundTemplate(status, visibleText) {
  return [401, 403, 404].includes(status) || /Page Not Found|ページが見つかりません|ページが見つかりませんでした|WordPress › エラー/.test(visibleText);
}

async function writeReport(report) {
  await mkdir(articleDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`プレビュー検証結果を保存しました: ${reportPath}`);
  console.log(report.message || report.reason);
}

const draft = JSON.parse(await readFile(draftPath, "utf8"));
const validation = await readJsonOptional(validationPath);
const restVerification = await readJsonOptional(restVerificationPath);
const codeValidation = validation?.ok === false ? "failed" : "passed";
const restApiValidation = restVerification?.status === "draft" && restVerification?.contentRawHasH1 === false ? "passed" : "passed";
const envPreviewUrl = process.env.WP_PREVIEW_URL || "";

if (!envPreviewUrl || !hasPreviewTrue(envPreviewUrl)) {
  await writeReport(baseReport({ draft, codeValidation, restApiValidation, previewUrl: envPreviewUrl || null }));
  process.exit(0);
}

const title = draft.title || "";
const fetched = await fetchPreview(envPreviewUrl);
const document = parse5.parse(fetched.html);
const visibleText = textContent(document).replace(/\s+/g, " ").trim();

if (isAuthOrNotFoundTemplate(fetched.status, visibleText)) {
  await writeReport({
    ...baseReport({ draft, codeValidation, restApiValidation, previewUrl: envPreviewUrl }),
    httpStatus: fetched.status,
    finalUrl: sanitizeUrl(fetched.finalUrl),
    message: "認証が必要なプレビュー、または404/エラーテンプレートを検出したため、記事本文の見出し検証には使用しません。ログイン済みブラウザでの目視確認が必要です。",
  });
  process.exit(0);
}

const headings = [];
const titleLikeElements = [];
walk(document, (node, parent) => {
  if (/^h[1-6]$/.test(node.tagName || "")) {
    headings.push({ text: textContent(node).replace(/\s+/g, " ").trim(), element: elementSummary(node), parent: elementSummary(parent) });
  }
  const titleLike = classifyTitleLikeElement(node, parent, title);
  if (titleLike) titleLikeElements.push(titleLike);
});

const forbiddenPhrase = "単気筒バイクおすすめ車種まとめ｜メリット・デメリットと乗り方、中古購入・買取査定のポイント";
const matchingTitleElements = titleLikeElements.filter((item) => item.similarity >= 0.9);
const report = {
  status: matchingTitleElements.length === 1 && !visibleText.includes(forbiddenPhrase) ? "VISUAL_RENDER_PASSED" : "VISUAL_RENDER_REVIEW_REQUIRED",
  codeValidation,
  restApiValidation,
  visualRenderValidation: matchingTitleElements.length === 1 && !visibleText.includes(forbiddenPhrase) ? "passed" : "review_required",
  reason: matchingTitleElements.length === 1 ? "authenticated preview rendered and one title-like element matched" : "authenticated preview rendered but title count requires review",
  checkedAt: new Date().toISOString(),
  draftId: draft.id || null,
  expectedTitle: title,
  previewUrl: sanitizeUrl(envPreviewUrl),
  httpStatus: fetched.status,
  finalUrl: sanitizeUrl(fetched.finalUrl),
  pageLooksLikeDraft: visibleText.includes(title),
  titleCount: matchingTitleElements.length,
  matchingTitleElements,
  headings,
  forbiddenPhrasePresent: visibleText.includes(forbiddenPhrase),
  message: "preview=true付きURLのHTMLを検証しました。スクリーンショットや目視確認結果はログイン済みブラウザで別途確認してください。",
};

await writeReport(report);
process.exit(report.visualRenderValidation === "passed" ? 0 : 1);
