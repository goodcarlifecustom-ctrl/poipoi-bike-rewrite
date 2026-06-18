import { readFile } from "node:fs/promises";

/**
 * @typedef {Object} RequiredLink
 * @property {string} anchor 必須アンカーテキスト
 * @property {string} url リンク先URL
 * @property {"internal"|"external"} [kind] 内部/外部リンク種別
 * @property {Record<string, string|boolean|null|undefined>} [attrs] 追加/上書き属性
 */

const PROTECTED_BLOCK_RE = /<a\b[\s\S]*?<\/a>|<h[1-6]\b[\s\S]*?<\/h[1-6]>|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<code\b[\s\S]*?<\/code>|<pre\b[\s\S]*?<\/pre>/gi;
const TAG_RE = /<[^>]+>/g;

export async function loadRequiredLinks(configPath = "rules/required-links.json") {
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return normalizeRequiredLinks(Array.isArray(parsed) ? parsed : parsed.requiredLinks);
}

export function normalizeRequiredLinks(requiredLinks = []) {
  if (!Array.isArray(requiredLinks)) throw new TypeError("requiredLinks must be an array");
  return requiredLinks.map((link, index) => {
    const anchor = String(link.anchor ?? link.anchorText ?? "").trim();
    const url = String(link.url ?? link.href ?? "").trim();
    if (!anchor) throw new Error(`requiredLinks[${index}].anchor is required`);
    if (!url) throw new Error(`requiredLinks[${index}].url is required`);
    const kind = link.kind || (isInternalUrl(url) ? "internal" : "external");
    if (!["internal", "external"].includes(kind)) throw new Error(`requiredLinks[${index}].kind must be internal or external`);
    return { anchor, url, kind, attrs: link.attrs || {} };
  });
}

export function ensureRequiredAnchors(html, requiredLinks = []) {
  let output = String(html);
  for (const link of normalizeRequiredLinks(requiredLinks)) {
    if (anchorLinkMatches(output, link).length > 0) continue;
    if (anchorTextInsideAnyLink(output, link.anchor)) continue;
    const next = linkFirstUnprotectedText(output, link);
    if (next !== output) output = next;
  }
  return output;
}

export function validateRequiredAnchors(html, requiredLinks = []) {
  const errors = [];
  for (const link of normalizeRequiredLinks(requiredLinks)) {
    const matches = anchorLinkMatches(html, link);
    if (matches.length === 0) {
      errors.push(`必須リンクがありません: anchor="${link.anchor}" url="${link.url}"`);
    } else if (matches.length > 1) {
      errors.push(`必須リンクが重複しています: anchor="${link.anchor}" url="${link.url}" count=${matches.length}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function linkFirstUnprotectedText(html, link) {
  const parts = splitProtected(html);
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].protected) continue;
    const linked = linkFirstTextOccurrence(parts[i].value, link);
    if (linked.changed) {
      parts[i].value = linked.html;
      return parts.map((part) => part.value).join("");
    }
  }
  return html;
}

function splitProtected(html) {
  const parts = [];
  let lastIndex = 0;
  for (const match of html.matchAll(PROTECTED_BLOCK_RE)) {
    if (match.index > lastIndex) parts.push({ value: html.slice(lastIndex, match.index), protected: false });
    parts.push({ value: match[0], protected: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < html.length) parts.push({ value: html.slice(lastIndex), protected: false });
  return parts;
}

function linkFirstTextOccurrence(fragment, link) {
  const tokens = [];
  let lastIndex = 0;
  for (const match of fragment.matchAll(TAG_RE)) {
    if (match.index > lastIndex) tokens.push({ value: fragment.slice(lastIndex, match.index), tag: false });
    tokens.push({ value: match[0], tag: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < fragment.length) tokens.push({ value: fragment.slice(lastIndex), tag: false });

  for (const token of tokens) {
    if (token.tag) continue;
    const index = token.value.indexOf(link.anchor);
    if (index < 0) continue;
    token.value = `${token.value.slice(0, index)}${buildAnchor(link)}${token.value.slice(index + link.anchor.length)}`;
    return { changed: true, html: tokens.map((item) => item.value).join("") };
  }
  return { changed: false, html: fragment };
}

export function buildAnchor(link) {
  const attrs = attributesFor(link);
  return `<a${Object.entries(attrs).map(([name, value]) => value === true ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`).join("")}>${escapeHtml(link.anchor)}</a>`;
}

function attributesFor(link) {
  const attrs = { href: link.url };
  if ((link.kind || (isInternalUrl(link.url) ? "internal" : "external")) === "external") {
    attrs.target = "_blank";
    attrs.rel = "noopener noreferrer";
  }
  for (const [key, value] of Object.entries(link.attrs || {})) {
    if (value === false || value == null) delete attrs[key];
    else attrs[key] = value;
  }
  return attrs;
}

function anchorLinkMatches(html, link) {
  const matches = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attrValue(match[1], "href");
    const text = stripTags(match[2]).trim();
    if (href === link.url && text === link.anchor) matches.push(match[0]);
  }
  return matches;
}

function anchorTextInsideAnyLink(html, anchor) {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].some((match) => stripTags(match[1]).trim() === anchor);
}

function attrValue(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? decodeHtml(match[2]) : "";
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
}

function isInternalUrl(url) {
  return url.startsWith("/") || url.startsWith("#") || /^https?:\/\/(?:www\.)?poi-poi\.co\.jp\b/i.test(url);
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function decodeHtml(value) {
  return String(value).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'");
}
