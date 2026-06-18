#!/usr/bin/env node

import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FALLBACK = "追加確認が必要";
const ARTICLE_DIR = process.argv[2] || "articles/sample-article";
const rewrittenPath = path.join(ARTICLE_DIR, "rewritten.html");
const originalPath = path.join(ARTICLE_DIR, "original.html");
const resultPath = path.join(ARTICLE_DIR, "comparison-table.json");
const changeLogPath = path.join(ARTICLE_DIR, "change-log.md");

const includeKeywords = ["おすすめ", "ランキング", "比較", "買取", "査定", "サービス", "業者", "店舗", "店", "出張", "一括査定", "地域", "車種", "売却", "紹介", "人気", "厳選", "ベスト", "一覧"];
const excludeKeywords = ["faq", "よくある質問", "質問", "まとめ", "注意点", "注意", "デメリット", "目次", "この記事でわかること", "選び方", "方法", "手順", "チェックリスト", "ポイント", "確認", "避け", "使い方", "リスク", "必要書類", "流れ"];
const excludedHeadingPatterns = [/を選ぶ/u, /を確認/u, /のポイント/u, /チェックリスト/u, /方法/u, /手順/u, /注意/u, /避け/u, /必要書類/u, /流れ/u, /費用を抑える/u];
const serviceNameHints = ["買取", "査定", "サービス", "業者", "バイク", "オートバイ", "出張", "一括査定", "店", "店舗", "公式", "センター", "ランド", "ワン", "MAX", "原付", "旧車", "不動車", "事故車"];
const serviceKeywords = ["バイク", "買取", "査定", "売却", "出張", "一括査定", "サービス", "業者", "公式", "費用", "相場"];
const shopKeywords = ["店舗", "エリア", "地域", "住所", "アクセス", "場所", "店", "持ち込み"];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stripTags(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attrValue(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? match[2] : "";
}

function isInternalOrTocLink(href) {
  if (!href) return true;
  const normalized = href.trim();
  return normalized.startsWith("#") || normalized.startsWith("/") || normalized.startsWith("javascript:") || normalized.startsWith("mailto:") || normalized.startsWith("tel:");
}

function findNearbyLink(htmlFragment) {
  for (const match of htmlFragment.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attrValue(match[1], "href");
    const label = stripTags(match[2]) || "公式サイト";
    if (!isInternalOrTocLink(href)) return { href, label };
  }
  return null;
}

function extractSentence(text, keywords) {
  const sentences = text.split(/[。！？!?\n]/).map((s) => s.trim()).filter(Boolean);
  const found = sentences.find((sentence) => keywords.some((keyword) => sentence.includes(keyword)) && sentence.length >= 8);
  if (!found) return FALLBACK;
  return found.length > 90 ? `${found.slice(0, 87)}…` : found;
}

function headingText(rawHeading) {
  return stripTags(rawHeading).replace(/^\s*\d+[.．、位)]\s*/, "").trim();
}

function shouldExcludeHeading(text, contextText) {
  const combined = `${text} ${contextText}`.toLowerCase();
  return excludeKeywords.some((keyword) => combined.includes(keyword)) || excludedHeadingPatterns.some((pattern) => pattern.test(text));
}

function contextIsRelevant(text) {
  return includeKeywords.some((keyword) => text.includes(keyword));
}

function parentIsComparisonSource(parentH2) {
  if (!parentH2) return false;
  if (excludeKeywords.some((keyword) => parentH2.toLowerCase().includes(keyword))) return false;
  return /(おすすめ|ランキング|比較|人気|厳選|紹介|ベスト|一覧|買取業者|査定サービス|売却方法|出張買取|一括査定)/u.test(parentH2);
}

function looksLikeServiceName(text) {
  const normalized = text.replace(/^\s*[0-9０-９]+[位.．、)]\s*/u, "").trim();
  if (!normalized || normalized.length > 38) return false;
  if (excludedHeadingPatterns.some((pattern) => pattern.test(normalized))) return false;
  if (/[。！？]/u.test(normalized)) return false;
  return serviceNameHints.some((hint) => normalized.toLowerCase().includes(hint.toLowerCase())) || /^[A-Za-z0-9][A-Za-z0-9+ ._-]{1,25}$/u.test(normalized);
}

function candidateQuality(candidates) {
  const cellCount = candidates.length * 4;
  const fallbackCount = candidates.reduce((total, candidate) => total + ["feature", "price", "suitableFor", "caution"].filter((field) => candidate[field] === FALLBACK).length, 0);
  const linkCount = candidates.filter((candidate) => candidate.link).length;
  return {
    fallbackCount,
    cellCount,
    fallbackRatio: cellCount === 0 ? 1 : fallbackCount / cellCount,
    linkCount,
    linkRatio: candidates.length === 0 ? 0 : linkCount / candidates.length,
  };
}

function parseHeadingSections(html) {
  const matches = [...html.matchAll(/<h([23])\b[^>]*>[\s\S]*?<\/h\1>/gi)].map((match) => ({
    level: Number(match[1]),
    raw: match[0],
    text: headingText(match[0]),
    index: match.index,
  }));

  return matches.map((heading, i) => {
    const nextIndex = matches[i + 1]?.index ?? html.length;
    const body = html.slice(heading.index + heading.raw.length, nextIndex);
    const parentH2 = heading.level === 2
      ? heading.text
      : [...matches.slice(0, i)].reverse().find((candidate) => candidate.level === 2)?.text || "";
    return { ...heading, body, parentH2 };
  });
}

function extractCandidates(html) {
  const sections = parseHeadingSections(html);
  const candidates = [];

  for (const section of sections) {
    if (section.level !== 3) continue;
    const contextText = `${section.parentH2} ${section.text}`;
    if (!parentIsComparisonSource(section.parentH2)) continue;
    if (!contextIsRelevant(contextText)) continue;
    if (shouldExcludeHeading(section.text, contextText)) continue;
    const bodyText = stripTags(section.body);
    const link = findNearbyLink(section.body.slice(0, 2500));
    if (!link && !looksLikeServiceName(section.text)) continue;
    if (!looksLikeServiceName(section.text) && !link) continue;
    candidates.push({
      name: section.text,
      feature: extractSentence(bodyText, ["特徴", "メリット", "おすすめ", "強み", "高価買取", "出張", "査定", "対応"]),
      price: extractSentence(bodyText, ["料金", "費用", "無料", "手数料", "査定料", "出張料", "キャンセル", "円", "価格"]),
      suitableFor: extractSentence(bodyText, ["向いて", "おすすめ", "人", "売りたい", "高く", "不動車", "事故車", "原付", "カスタム"]),
      caution: extractSentence(bodyText, ["注意", "デメリット", "ただし", "一方", "確認", "トラブル", "契約"]),
      link,
    });
  }

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.name.replace(/\s+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique.slice(0, 10);
}

function detectColumns(html) {
  const text = stripTags(html);
  if (serviceKeywords.some((keyword) => text.includes(keyword))) {
    return ["サービス名", "特徴", "手数料・費用感", "おすすめな人", "注意点", "公式サイト・詳細"];
  }
  if (shopKeywords.some((keyword) => text.includes(keyword))) {
    return ["名称", "特徴", "対応エリア", "おすすめな人", "注意点", "公式サイト・詳細"];
  }
  return ["比較項目", "特徴", "メリット", "注意点", "おすすめな人", "詳細"];
}

function detailLinkFor(candidate) {
  const href = candidate.detailUrl || candidate.link?.href;
  if (!href) return null;
  return { href, label: candidate.detailAnchor || candidate.link?.label || "公式情報で確認" };
}

function buildTable(candidates, columns) {
  const header = columns.map((column) => `        <th style="width: 150px;">${escapeHtml(column)}</th>`).join("\n");
  const rows = candidates.map((candidate) => {
    const detailLink = detailLinkFor(candidate);
    const linkCell = detailLink
      ? `<a href="${escapeHtml(detailLink.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(detailLink.label || "公式情報で確認")}</a>`
      : FALLBACK;
    const third = columns[2] === "対応エリア" || columns[2] === "メリット" ? candidate.feature : candidate.price;
    return `      <tr>\n        <td><strong>${escapeHtml(candidate.name)}</strong></td>\n        <td>${escapeHtml(candidate.feature)}</td>\n        <td>${escapeHtml(third)}</td>\n        <td>${escapeHtml(candidate.suitableFor)}</td>\n        <td>${escapeHtml(candidate.caution)}</td>\n        <td>${linkCell}</td>\n      </tr>`;
  }).join("\n");

  return `<div class="comparison-table-block" style="overflow-x: auto; width: 100%; -webkit-overflow-scrolling: touch;">\n  <table border="1" cellpadding="10" cellspacing="0" style="width: 100%; table-layout: fixed;">\n    <thead>\n      <tr>\n${header}\n      </tr>\n    </thead>\n    <tbody>\n${rows}\n    </tbody>\n  </table>\n</div>`;
}

function hasComparisonTable(html) {
  return /class=["'][^"']*comparison-table-block/i.test(html) || /<table\b[\s\S]*?(比較項目|サービス名|名称|公式サイト・詳細|料金・費用感)[\s\S]*?<\/table>/i.test(html);
}

function findCapboxEndAfterWakaru(html) {
  const wakaruIndex = html.search(/この記事でわかること/i);
  if (wakaruIndex < 0) return null;

  const stack = [];
  const containingCapboxes = [];
  const tagRe = /<\/?div\b[^>]*>/gi;
  for (const match of html.matchAll(tagRe)) {
    if (!match[0].startsWith("</")) {
      stack.push({ start: match.index, tag: match[0] });
      continue;
    }
    const open = stack.pop();
    if (!open) continue;
    const end = match.index + match[0].length;
    if (open.start <= wakaruIndex && wakaruIndex < end) {
      const block = html.slice(open.start, end);
      if (/cap_box|capbox|swell-block-capbox/i.test(open.tag) || /cap_box|capbox|swell-block-capbox/i.test(block.slice(0, 400))) {
        containingCapboxes.push({ start: open.start, end });
      }
    }
  }

  if (containingCapboxes.length === 0) return null;
  containingCapboxes.sort((a, b) => a.start - b.start || b.end - a.end);
  return containingCapboxes[0].end;
}

function findInsertion(html) {
  const capboxEnd = findCapboxEndAfterWakaru(html);
  if (capboxEnd !== null) return { index: capboxEnd, label: "「この記事でわかること」capboxの直後" };

  const recommendH2 = html.match(/<h2\b[^>]*>[\s\S]*?(おすすめ|ランキング|買取業者|査定サービス)[\s\S]*?<\/h2>/i);
  if (recommendH2?.index !== undefined) return { index: recommendH2.index, label: "おすすめ・ランキング系H2の直前" };

  const compareH2 = html.match(/<h2\b[^>]*>[\s\S]*?(比較)[\s\S]*?<\/h2>/i);
  if (compareH2?.index !== undefined) return { index: compareH2.index, label: "最初の比較系H2の直前" };

  return { index: 0, label: "記事冒頭" };
}

function insertTable(html, tableHtml) {
  const insertion = findInsertion(html);
  return { html: `${html.slice(0, insertion.index)}\n\n${tableHtml}\n\n${html.slice(insertion.index)}`, insertionLabel: insertion.label };
}

const sourcePath = await exists(rewrittenPath) ? rewrittenPath : (await exists(originalPath) ? originalPath : null);
if (!sourcePath) {
  console.error(`${rewrittenPath} または ${originalPath} が見つかりません。`);
  process.exit(1);
}

const html = await readFile(sourcePath, "utf8");
const candidates = extractCandidates(html);
const alreadyExists = hasComparisonTable(html);
let outputHtml = html;
let inserted = false;
let insertionLabel = "";
let reason = "";

if (alreadyExists) {
  reason = "既存の比較表があるため、新規作成は行いませんでした。";
} else if (candidates.length < 2) {
  reason = "比較候補が2件未満のため、比較表を作成しませんでした。";
} else {
  const quality = candidateQuality(candidates);
  const nonServiceNames = candidates.filter((candidate) => !looksLikeServiceName(candidate.name) && !candidate.link).map((candidate) => candidate.name);
  if (quality.fallbackRatio >= 0.5) {
    reason = `「${FALLBACK}」が半数以上になるため、低品質な比較表は作成しませんでした。`;
  } else if (quality.linkRatio < 0.5) {
    reason = "公式サイト・詳細リンクを持つ候補が半数未満のため、比較表を作成しませんでした。";
  } else if (nonServiceNames.length > 0) {
    reason = `サービス名ではない候補が含まれるため、比較表を作成しませんでした: ${nonServiceNames.join(", ")}`;
  }
}

if (!alreadyExists && !inserted && !reason) {
  const tableHtml = buildTable(candidates, detectColumns(html));
  const insertedResult = insertTable(html, tableHtml);
  outputHtml = insertedResult.html;
  insertionLabel = insertedResult.insertionLabel;
  inserted = true;
  await mkdir(ARTICLE_DIR, { recursive: true });
  await writeFile(rewrittenPath, outputHtml, "utf8");
}

const fallbackFields = candidates.flatMap((candidate) => ["feature", "price", "suitableFor", "caution"].filter((field) => candidate[field] === FALLBACK).map((field) => `${candidate.name}:${field}`));
const result = {
  ok: true,
  generatedAt: new Date().toISOString(),
  articleDir: ARTICLE_DIR,
  sourcePath,
  rewrittenPath,
  inserted,
  insertionLabel: inserted ? insertionLabel : null,
  reason: inserted ? null : reason,
  extractedCandidateCount: candidates.length,
  tableItemCount: inserted ? candidates.length : 0,
  fallbackFields,
  externalAccess: "公式サイトへの追加アクセスなし。記事内リンク周辺本文から抽出。",
  candidates,
};

await mkdir(ARTICLE_DIR, { recursive: true });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

const log = `\n## 比較表作成・挿入（${new Date().toISOString()}）\n\n- 挿入位置: ${inserted ? insertionLabel : "未挿入"}\n- 抽出した候補数: ${candidates.length}\n- 表に入れた項目数: ${inserted ? candidates.length : 0}\n- 情報不足で「追加確認が必要」とした項目: ${fallbackFields.length ? fallbackFields.join(", ") : "なし"}\n- 公式サイトまたは外部ページへのアクセス確認: 追加アクセスなし\n- ${inserted ? "比較表を作成・挿入しました。" : `比較表を作成しなかった理由: ${reason}`}\n`;
await appendFile(changeLogPath, log, "utf8");

console.log(`比較表処理結果を保存しました: ${resultPath}`);
console.log(inserted ? `比較表を挿入しました: ${rewrittenPath}` : reason);
