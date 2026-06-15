#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const articleDir = process.argv[2] || "articles/sample-article";
const rewrittenPath = path.join(articleDir, "rewritten.html");
const reportPath = path.join(articleDir, "check-report.md");

const genericSafetyPhrases = [
  "好意や合意が自動的に生まれるわけではありません",
  "相手の自由意思を最優先にしましょう",
  "風俗での接客はあくまで仕事",
  "相手の生活リズムや仕事への向き合い方",
  "目先の費用だけではなく",
  "関係が終わるときの連絡方法",
  "希望条件を丁寧に確認しましょう",
];

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function normalizeText(value) {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCore(value) {
  return normalizeText(value)
    .replace(/^補足ポイント\s*[0-9０-９]+\s*[:：]\s*/u, "")
    .replace(/^[^。！？]{1,80}については、/u, "")
    .replace(/[ァ-ヶー一-龠々〆ヵヶぁ-んA-Za-z0-9０-９]+に関する出会い/g, "〇〇に関する出会い")
    .replace(/[ァ-ヶー一-龠々〆ヵヶぁ-んA-Za-z0-9０-９]+で失敗しないためには/g, "〇〇で失敗しないためには")
    .replace(/[0-9０-９]+/g, "#")
    .replace(/[\s「」『』（）()【】\[\]、，。．・:：;；!！?？]/g, "")
    .trim();
}

function normalizeTopicIntro(value) {
  return normalizeText(value)
    .replace(/^[^。！？]{1,80}については、/u, "")
    .replace(/[\s「」『』（）()【】\[\]、，。．・:：;；!！?？]/g, "")
    .trim();
}

function normalizeSupplement(value) {
  return normalizeText(value)
    .replace(/^補足ポイント\s*[0-9０-９]+\s*[:：]\s*/u, "")
    .replace(/[\s「」『』（）()【】\[\]、，。．・:：;；!！?？]/g, "")
    .trim();
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length < 40) return 0;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  const grams = new Set();
  for (let i = 0; i <= shorter.length - 3; i += 1) grams.add(shorter.slice(i, i + 3));
  if (grams.size === 0) return 0;
  let overlap = 0;
  for (const gram of grams) if (longer.includes(gram)) overlap += 1;
  return overlap / grams.size;
}

function linkHrefs(fragment) {
  return [...fragment.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi)].map((m) => m[2]);
}

function genericSafetyHits(text) {
  return genericSafetyPhrases.filter((phrase) => text.includes(phrase));
}

function collectThinH3Sections(input) {
  const thin = [];
  let currentH2 = "";
  const blockRe = /<h2\b[^>]*>[\s\S]*?<\/h2>[\s\S]*?(?=<h2\b|$)/gi;
  for (const blockMatch of input.matchAll(blockRe)) {
    const block = blockMatch[0];
    currentH2 = normalizeText(block.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i)?.[0] || currentH2);
    const h3Re = /<h3\b[^>]*>[\s\S]*?<\/h3>[\s\S]*?(?=<h3\b|<h2\b|$)/gi;
    for (const h3Match of block.matchAll(h3Re)) {
      const section = h3Match[0];
      const h3 = normalizeText(section.match(/<h3\b[^>]*>[\s\S]*?<\/h3>/i)?.[0] || "");
      const body = section.replace(/<h3\b[^>]*>[\s\S]*?<\/h3>/i, "");
      const length = normalizeText(body).length;
      if (h3 && length < 80) thin.push({ heading: `${currentH2} > ${h3}`, length });
    }
  }
  return thin;
}

const genericPatterns = [
  /匿名性の高さだけに頼らず.*?(個人情報保護委員会|e-Gov法令検索)/,
  /プロフィールの誠実さ、合意形成、個人情報保護、相手への敬意/,
  /アフィリエイト導線としておすすめアプリを紹介する場合も/,
];

const sectionTitlePatterns = [
  /安全に使うためのチェックリスト/,
  /よくある質問/,
];

let html = await readFile(rewrittenPath, "utf8");
const originalHtml = html;
const removedParagraphs = [];
const removedLinks = [];
const keptLinks = new Set();
const seenExact = new Map();
const seenTopicIntro = [];
const seenSupplement = new Map();
const keptGenericSafety = [];
let publicLinkAlreadyKept = false;

html = html.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, (paragraph) => {
  const text = normalizeText(paragraph);
  const exactKey = normalizeCore(paragraph);
  const topicKey = normalizeTopicIntro(paragraph);
  const supplementKey = normalizeSupplement(paragraph);
  const hrefs = linkHrefs(paragraph);
  const isGeneric = genericPatterns.some((pattern) => pattern.test(text));
  const safetyHits = genericSafetyHits(text);
  const isSupplement = /^補足ポイント\s*[0-9０-９]+\s*[:：]/u.test(text);
  const hasTopicIntro = /^[^。！？]{1,80}については、/u.test(text);
  const hasPublicLink = hrefs.some((href) => /ppc\.go\.jp|e-gov\.go\.jp|npa\.go\.jp|caa\.go\.jp|gov|go\.jp/.test(href));

  if (isGeneric) {
    if (publicLinkAlreadyKept || !hasPublicLink) {
      removedParagraphs.push({ category: "generic-link", reason: "H3直下などに繰り返された汎用安全・導線文", text, hrefs });
      removedLinks.push(...hrefs);
      return "";
    }
    publicLinkAlreadyKept = true;
  }

  if (isSupplement && supplementKey && seenSupplement.has(supplementKey)) {
    removedParagraphs.push({ category: "supplement", reason: "番号だけ差し替えられた補足文", text, hrefs });
    removedLinks.push(...hrefs);
    return "";
  }

  if (hasTopicIntro && topicKey.length >= 40) {
    const similar = seenTopicIntro.find((item) => similarity(topicKey, item.key) >= 0.9);
    if (similar) {
      removedParagraphs.push({ category: "topic-intro", reason: "H3タイトル差し替え型の汎用文", text, hrefs });
      removedLinks.push(...hrefs);
      return "";
    }
  }

  if (safetyHits.length >= 2 && exactKey.length >= 40) {
    const similarSafety = seenTopicIntro.find((item) => item.safety && similarity(exactKey, item.key) >= 0.88);
    if (similarSafety) {
      removedParagraphs.push({ category: "generic-safety", reason: "高類似の汎用コンプラ安全文", text, hrefs });
      removedLinks.push(...hrefs);
      return "";
    }
  }

  if (exactKey && seenExact.has(exactKey)) {
    removedParagraphs.push({ category: "exact", reason: "完全一致またはKW差し替え類似のpタグ重複", text, hrefs });
    removedLinks.push(...hrefs);
    return "";
  }

  seenExact.set(exactKey, true);
  if (hasTopicIntro && topicKey.length >= 40) seenTopicIntro.push({ key: topicKey, safety: safetyHits.length > 0 });
  if (safetyHits.length >= 2 && exactKey.length >= 40) seenTopicIntro.push({ key: exactKey, safety: true });
  if (isSupplement && supplementKey) seenSupplement.set(supplementKey, true);
  if (safetyHits.length > 0) keptGenericSafety.push({ text, hits: safetyHits });
  hrefs.forEach((href) => keptLinks.add(href));
  return paragraph;
});

for (const titlePattern of sectionTitlePatterns) {
  let seen = false;
  html = html.replace(/<h2\b[^>]*>[\s\S]*?<\/h2>[\s\S]*?(?=<h2\b|$)/gi, (section) => {
    const title = normalizeText(section.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i)?.[0] || "");
    if (!titlePattern.test(title)) return section;
    if (!seen) {
      seen = true;
      linkHrefs(section).forEach((href) => keptLinks.add(href));
      return section;
    }
    removedParagraphs.push({ category: "section", reason: `重複セクション「${title}」`, text: title, hrefs: linkHrefs(section) });
    removedLinks.push(...linkHrefs(section));
    return "";
  });
}

function uniquifyHeadingIds(input) {
  const seenIds = new Map();
  return input.replace(/<(h[23])\b([^>]*)>/gi, (tag, name, attrs) => {
    const idMatch = attrs.match(/\bid\s*=\s*(["'])([^"']+)\1/i);
    if (!idMatch) return tag;
    const id = idMatch[2];
    const count = seenIds.get(id) || 0;
    seenIds.set(id, count + 1);
    if (count === 0) return tag;
    const nextId = `${id}-${count + 1}`;
    return `<${name}${attrs.replace(idMatch[0], `id=${idMatch[1]}${nextId}${idMatch[1]}`)}>`;
  });
}
html = uniquifyHeadingIds(html);
html = html.replace(/\n{3,}/g, "\n\n");

await writeFile(rewrittenPath, html, "utf8");

const thinHeadings = collectThinH3Sections(html);

const exactParagraphCounts = new Map();
for (const match of html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)) {
  const key = normalizeText(match[0]);
  if (!key) continue;
  exactParagraphCounts.set(key, (exactParagraphCounts.get(key) || 0) + 1);
}
const exactDuplicates = [...exactParagraphCounts.entries()].filter(([, count]) => count >= 2);

const validation = spawnSync(process.execPath, ["scripts/validate-rewritten.mjs", articleDir], {
  cwd: process.cwd(),
  encoding: "utf8",
});

const report = [
  "# 外部リンク・水増し文チェックレポート",
  "",
  `- 対象HTML: \`${rewrittenPath}\``,
  `- HTML修正: ${html === originalHtml ? "変更なし" : "変更あり"}`,
  `- 削除したH3タイトル差し替え型の重複段落数: ${removedParagraphs.filter((item) => item.category === "topic-intro").length}件`,
  `- 削除した番号差し替え型の補足文数: ${removedParagraphs.filter((item) => item.category === "supplement").length}件`,
  `- 削除した汎用注意文: ${removedParagraphs.filter((item) => item.category === "generic-safety" || item.category === "generic-link").length}件`,
  `- 完全一致するpタグ（2回以上）: ${exactDuplicates.length}件`,
  "",
  "## 残した汎用注意文",
  ...(keptGenericSafety.length ? keptGenericSafety.map((item, index) => `${index + 1}. ${item.text}`) : ["- なし"]),
  "",
  "## 削除した汎用注意文",
  ...(removedParagraphs.filter((item) => item.category === "generic-safety" || item.category === "generic-link").length
    ? removedParagraphs.filter((item) => item.category === "generic-safety" || item.category === "generic-link").map((item, index) => `${index + 1}. ${item.reason}: ${item.text}`)
    : ["- なし"]),
  "",
  "## 削除した重複文",
  ...(removedParagraphs.length ? removedParagraphs.map((item, index) => `${index + 1}. ${item.reason}: ${item.text}`) : ["- なし"]),
  "",
  "## 本文が空または薄くなった可能性があるH3一覧",
  ...(thinHeadings.length ? thinHeadings.map((item) => `- ${item.heading}（本文 ${item.length}文字） - 本文不足の可能性あり`) : ["- なし"]),
  "",
  "## 残した外部リンク",
  ...([...keptLinks].length ? [...keptLinks].map((href) => `- ${href}`) : ["- なし"]),
  "",
  "## 削除した外部リンク",
  ...([...new Set(removedLinks)].length ? [...new Set(removedLinks)].map((href) => `- ${href}`) : ["- なし"]),
  "",
  "## 完全一致pタグ重複",
  ...(exactDuplicates.length ? exactDuplicates.map(([text, count]) => `- ${count}回: ${text}`) : ["- なし"]),
  "",
  "## validate の結果",
  `- 結果: ${validation.status === 0 ? "成功" : "失敗"}`,
  ...(validation.stdout.trim() ? validation.stdout.trim().split("\n").map((line) => `- stdout: ${line}`) : []),
  ...(validation.stderr.trim() ? validation.stderr.trim().split("\n").map((line) => `- stderr: ${line}`) : []),
  "",
].join("\n");

await mkdir(articleDir, { recursive: true });
await writeFile(reportPath, report, "utf8");
console.log(`外部リンク・水増し文チェック結果を保存しました: ${reportPath}`);
if (exactDuplicates.length > 0 || validation.status !== 0) process.exitCode = 1;
