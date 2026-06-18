const INTERNAL_HOST_RE = /(^|\.)poi-poi\.co\.jp$/i;
const OFFICIAL_HINT_RE = /(公式|メーカー|製品情報|商品情報|公的|警察|国土交通省|消費者庁|個人情報保護委員会|e-Gov|法令|自治体|市役所|区役所|県庁|運輸局)/u;
const VAGUE_ANCHOR_RE = /^(こちら|ここ|詳細はこちら|詳しくはこちら|公式サイト|詳細|リンク)$/u;

export function stripTags(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] || "";
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function isExternalUrl(url) {
  const host = hostOf(url);
  return /^https?:\/\//i.test(url) && host && !INTERNAL_HOST_RE.test(host);
}

export function extractExternalLinks(html) {
  const links = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const url = attr(match[1], "href");
    if (!isExternalUrl(url)) continue;
    links.push({ url, anchor: stripTags(match[2]), html: match[0], index: match.index });
  }
  return links;
}

function titleText(html) {
  return stripTags(html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i)?.[0] || html.match(/<title\b[^>]*>[\s\S]*?<\/title>/i)?.[0] || "");
}

function scoreLink(link, articleHtml) {
  const title = titleText(articleHtml);
  let score = 0;
  if (OFFICIAL_HINT_RE.test(link.anchor)) score += 30;
  if (/\.go\.jp$|\.lg\.jp$/i.test(hostOf(link.url))) score += 25;
  if (/(official|www\.)/i.test(hostOf(link.url))) score += 5;
  const tokens = [...new Set(title.split(/[\s　、。・｜|【】「」（）()]+/u).filter((t) => t.length >= 2))];
  for (const token of tokens) if (link.anchor.includes(token) || decodeURIComponent(link.url).includes(token)) score += 4;
  score += Math.max(0, 10 - linksIndexPenalty(link.index));
  return score;
}

function linksIndexPenalty(index) { return Math.floor((index || 0) / 2000); }

export function selectPrimaryExternalLink(originalHtml, rewrittenHtml = originalHtml) {
  const unique = new Map();
  for (const link of extractExternalLinks(originalHtml)) if (!unique.has(link.url)) unique.set(link.url, link);
  const links = [...unique.values()];
  if (links.length === 0) return null;
  if (links.length === 1) return links[0];
  return links.sort((a, b) => scoreLink(b, `${originalHtml}\n${rewrittenHtml}`) - scoreLink(a, `${originalHtml}\n${rewrittenHtml}`))[0];
}

function firstH2Index(html) {
  const match = html.match(/<h2\b[^>]*>/i);
  return match?.index ?? -1;
}

function linkOccurrences(html, url) {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...html.matchAll(new RegExp(`<a\\b[^>]*\\bhref\\s*=\\s*(["'])${escaped}\\1[^>]*>[\\s\\S]*?<\\/a>`, "gi"))];
}

export function validateIntroExternalLink(originalHtml, rewrittenHtml) {
  const target = selectPrimaryExternalLink(originalHtml, rewrittenHtml);
  const errors = [];
  if (!target) return { ok: true, target: null, errors };
  const h2 = firstH2Index(rewrittenHtml);
  const occurrences = linkOccurrences(rewrittenHtml, target.url);
  if (occurrences.length === 0) errors.push(`対象外部リンクが出力記事にありません: ${target.url}`);
  if (occurrences.length > 1) errors.push(`対象外部リンクが重複しています: ${target.url}`);
  const first = occurrences[0];
  if (first && h2 >= 0 && first.index > h2) errors.push(`対象外部リンクが最初のH2より後にあります: ${target.url}`);
  if (first) {
    const anchor = stripTags(first[0]);
    const paragraph = paragraphContaining(rewrittenHtml, first.index);
    if (!anchor || VAGUE_ANCHOR_RE.test(anchor) || /^https?:\/\//i.test(anchor)) errors.push(`対象外部リンクのアンカーテキストが具体的ではありません: ${anchor}`);
    if (!paragraph || stripTags(paragraph) === anchor || /^\s*<p[^>]*>\s*<a\b[\s\S]*?<\/a>\s*<\/p>\s*$/i.test(paragraph)) errors.push("対象外部リンクが文章内の自然なアンカーとして使われていません");
  }
  return { ok: errors.length === 0, target, errors };
}

function paragraphContaining(html, index) {
  const before = html.lastIndexOf("<p", index);
  const after = html.indexOf("</p>", index);
  if (before === -1 || after === -1 || before > index) return "";
  return html.slice(before, after + 4);
}
