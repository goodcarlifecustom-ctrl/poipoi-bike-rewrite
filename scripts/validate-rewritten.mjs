#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureRequiredAnchors, loadRequiredLinks, validateRequiredAnchors } from "./lib/required-links.mjs";

const articleDir = process.argv[2] || "articles/sample-article";
const originalPath = path.join(articleDir, "original.html");
const rewrittenPath = path.join(articleDir, "rewritten.html");
const resultPath = path.join(articleDir, "validation-result.json");
const requiredLinksPath = path.join("rules", "required-links.json");

const checks = [];
let hasError = false;

function addCheck(name, passed, message, details = {}) {
  checks.push({ name, passed, message, details });
  if (!passed) hasError = true;
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function stripHtml(html) {
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
    .replace(/\s+/g, "")
    .trim();
}

function countHeadings(html, level) {
  return [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>`, "gi"))].length;
}

function collectHeadingIds(html, level) {
  const ids = [];
  const re = new RegExp(`<h${level}\\b([^>]*)>`, "gi");
  for (const match of html.matchAll(re)) {
    const idMatch = match[1].match(/\bid\s*=\s*["']([^"']+)["']/i);
    if (idMatch) ids.push(idMatch[1]);
  }
  return ids;
}

function duplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function countOccurrences(text, phrase) {
  return (text.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
}

const genericSafetyPhrases = [
  "査定前に洗車だけでなく書類も確認しましょう",
  "契約前に入金時期とキャンセル条件を確認しましょう",
  "ローン残債がある場合は事前に申告しましょう",
  "名義変更や廃車手続きの担当範囲を確認しましょう",
];

function collectParagraphTexts(html) {
  return [...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)]
    .map((match, index) => ({ index: index + 1, text: stripHtml(match[0]).replace(/\s+/g, " ").trim() }))
    .filter((item) => item.text);
}

function compactText(value) {
  return value.replace(/[\s「」『』（）()【】\[\]、，。．・:：;；!！?？]/g, "").trim();
}

function normalizeTopicIntroText(value) {
  return compactText(value.replace(/^[^。！？]{1,80}については、/u, ""));
}

function normalizeSupplementText(value) {
  return compactText(value.replace(/^補足ポイント\s*[0-9０-９]+\s*[:：]\s*/u, ""));
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

function duplicateGroups(items, keyFn, minLength = 1) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item.text);
    if (!key || key.length < minLength) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()]
    .filter(([, values]) => values.length >= 2)
    .map(([key, values]) => ({ key, paragraphs: values.map((item) => item.index), texts: values.map((item) => item.text) }));
}

function highSimilarityGroups(items, keyFn, threshold = 0.9) {
  const groups = [];
  for (const item of items) {
    const key = keyFn(item.text);
    if (!key || key.length < 40) continue;
    let group = groups.find((candidate) => similarity(key, candidate.key) >= threshold);
    if (!group) {
      group = { key, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups
    .filter((group) => group.items.length >= 2)
    .map((group) => ({ key: group.key, paragraphs: group.items.map((item) => item.index), texts: group.items.map((item) => item.text) }));
}

function collectParagraphContexts(html) {
  const contexts = [];
  const tokenRe = /<(h[23])\b[^>]*>[\s\S]*?<\/\1>|<p\b[^>]*>[\s\S]*?<\/p>/gi;
  let h2 = "";
  let h3 = "";
  let paragraphIndex = 0;
  for (const match of html.matchAll(tokenRe)) {
    const token = match[0];
    if (/^<h2\b/i.test(token)) {
      h2 = stripHtml(token);
      h3 = "";
    } else if (/^<h3\b/i.test(token)) {
      h3 = stripHtml(token);
    } else {
      paragraphIndex += 1;
      const text = stripHtml(token).replace(/\s+/g, " ").trim();
      contexts.push({ index: paragraphIndex, h2, h3, text, safetyHits: genericSafetyPhrases.filter((phrase) => text.includes(phrase)) });
    }
  }
  return contexts;
}

function consecutiveGenericSafetyAcrossH3(contexts) {
  const sequences = [];
  let current = [];
  for (const context of contexts) {
    if (context.h3 && context.safetyHits.length > 0) {
      if (current.length === 0 || current[current.length - 1].h3 !== context.h3) current.push(context);
    } else if (current.length > 1) {
      sequences.push(current);
      current = [];
    } else {
      current = [];
    }
  }
  if (current.length > 1) sequences.push(current);
  return sequences.map((sequence) => sequence.map((item) => ({ paragraph: item.index, h3: item.h3, hits: item.safetyHits })));
}

function longSimilarSupplementRuns(items) {
  const runs = [];
  let current = [];
  for (const item of items) {
    const isSupplement = /^補足ポイント\s*[0-9０-９]+\s*[:：]/u.test(item.text);
    if (!isSupplement) {
      if (current.length >= 10) runs.push(current);
      current = [];
      continue;
    }
    const key = normalizeSupplementText(item.text);
    if (current.length === 0 || similarity(key, current[0].key) >= 0.85) {
      current.push({ ...item, key });
    } else {
      if (current.length >= 10) runs.push(current);
      current = [{ ...item, key }];
    }
  }
  if (current.length >= 10) runs.push(current);
  return runs.map((run) => run.map((item) => ({ paragraph: item.index, text: item.text })));
}


function isPlaceholderRewritten(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "").trim();
  return (
    withoutComments.length === 0 &&
    /Codexがリライト後HTMLをここに作成します|リライト後HTML|placeholder/i.test(html)
  ) || /^<!--\s*Codexがリライト後HTMLをここに作成します\s*-->\s*$/u.test(html.trim());
}

function tableBlocks(html) {
  return [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function isComparisonTable(tableHtml) {
  return /(比較項目|サービス名|名称|公式サイト・詳細|料金・費用感)/i.test(stripHtml(tableHtml));
}

function tableLinks(tableHtml) {
  return [...tableHtml.matchAll(/<a\b([^>]*)>/gi)].map((match) => match[1]);
}

function attrIncludes(attrs, name, expected) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  if (!match) return false;
  return match[2].split(/\s+/).includes(expected);
}

function likelyNeedsComparisonTable(html) {
  const text = stripHtml(html);
  const h3Count = countHeadings(html, 3);
  return h3Count >= 2 && /(おすすめ|ランキング|比較|買取|査定|サービス|業者|店舗|売却|紹介)/.test(text);
}

function divBlocksWithClass(html, classPattern) {
  const blocks = [];
  const divRe = /<\/?div\b[^>]*>/gi;
  for (const start of html.matchAll(/<div\b[^>]*class\s*=\s*(["'])(?=[^"']*?(?:cap_box|capbox|swell-block-capbox))[^"']*\1[^>]*>/gi)) {
    divRe.lastIndex = start.index;
    let depth = 0;
    for (const match of html.matchAll(divRe)) {
      if (match.index < start.index) continue;
      if (match[0].startsWith("</")) depth -= 1;
      else depth += 1;
      if (depth === 0) {
        const block = html.slice(start.index, match.index + match[0].length);
        if (classPattern.test(block)) blocks.push(block);
        break;
      }
    }
  }
  return blocks;
}

function wakarukotoCapboxes(html) {
  return divBlocksWithClass(html, /cap_box|capbox|swell-block-capbox/i).filter((block) => /この記事でわかること/u.test(stripHtml(block)));
}

function headingSections(html) {
  const matches = [...html.matchAll(/<h([23])\b[^>]*>[\s\S]*?<\/h\1>/gi)].map((match) => ({
    level: Number(match[1]),
    html: match[0],
    text: stripHtml(match[0]).replace(/\s+/g, " ").trim(),
    index: match.index,
  }));
  return matches.map((heading, index) => ({
    ...heading,
    body: html.slice(heading.index + heading.html.length, matches[index + 1]?.index ?? html.length),
  }));
}

function emptyHeadingSections(html) {
  return headingSections(html).filter((section) => {
    const bodyText = stripHtml(section.body).replace(/\s+/g, "").trim();
    return bodyText.length === 0;
  });
}

function normalizedMassHeading(text) {
  return text.replace(/[0-9０-９]+/gu, "#").replace(/\s+/g, "").trim();
}

function massGeneratedHeadings(html) {
  const groups = new Map();
  for (const section of headingSections(html)) {
    if (!/[0-9０-９]/u.test(section.text)) continue;
    if (!/(具体例|ポイント|チェックリスト|使い分け|見直し|確認)/u.test(section.text)) continue;
    const key = normalizedMassHeading(section.text);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(section.text);
  }
  return [...groups.entries()].filter(([, values]) => values.length >= 3).map(([key, values]) => ({ key, values }));
}

function h3DuplicateTexts(html) {
  const texts = [...html.matchAll(/<h3\b[^>]*>[\s\S]*?<\/h3>/gi)].map((match) => stripHtml(match[0]).replace(/\s+/g, " ").trim()).filter(Boolean);
  return duplicates(texts);
}

function unnaturalJapaneseHits(text) {
  const patterns = [
    /サービスサービス/u,
    /必要ことです/u,
    /注意ことです/u,
    /重要ことです/u,
    /([^。！？]{1,40})は、\1は、/u,
  ];
  return patterns.filter((pattern) => pattern.test(text)).map((pattern) => String(pattern));
}

function tableRows(tableHtml) {
  return [...tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((match) => match[0]).filter((row) => /<td\b/i.test(row));
}

function tableCells(rowHtml) {
  return [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1]).replace(/\s+/g, " ").trim());
}

function fallbackRatioInTable(tableHtml) {
  const cells = tableRows(tableHtml).flatMap(tableCells);
  const fallbackCount = cells.filter((cell) => cell.includes("追加確認が必要")).length;
  return { fallbackCount, cellCount: cells.length, ratio: cells.length === 0 ? 0 : fallbackCount / cells.length };
}

function abstractComparisonItems(tableHtml) {
  const abstractPatterns = [/を選ぶ/u, /を確認/u, /のポイント/u, /チェックリスト/u, /必要書類/u, /手順/u, /注意/u, /流れ/u];
  return tableRows(tableHtml).map((row) => tableCells(row)[0] || "").filter((cell) => abstractPatterns.some((pattern) => pattern.test(cell)));
}

function hasSevereHtmlBreakage(html) {
  const stack = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tagRe = /<\/?([a-z][a-z0-9-]*)(?:\s[^<>]*)?>/gi;

  for (const match of html.matchAll(tagRe)) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    if (voidTags.has(tag) || full.endsWith("/>")) continue;
    if (full.startsWith("</")) {
      const last = stack.pop();
      if (last !== tag) return true;
    } else {
      stack.push(tag);
    }
  }

  return stack.length > 0;
}

const original = await readOptional(originalPath);
let rewritten = await readOptional(rewrittenPath);
let requiredLinks = [];
try {
  requiredLinks = await loadRequiredLinks(requiredLinksPath);
} catch (error) {
  addCheck("required_links_config_valid", false, `${requiredLinksPath} を読み込める`, { error: error.message });
}

if (rewritten !== null && requiredLinks.length > 0) {
  const ensured = ensureRequiredAnchors(rewritten, requiredLinks);
  if (ensured !== rewritten) {
    rewritten = ensured;
    await writeFile(rewrittenPath, rewritten, "utf8");
  }
}

addCheck("original_exists", original !== null, `${originalPath} が存在する`);
addCheck("rewritten_exists", rewritten !== null, `${rewrittenPath} が存在する`);

const rewrittenIsPlaceholder = rewritten !== null && isPlaceholderRewritten(rewritten);

if (rewritten !== null) {
  addCheck("rewritten_not_empty", rewritten.trim().length > 0, "rewritten.html が空ではない", {
    bytes: Buffer.byteLength(rewritten, "utf8"),
  });
  if (rewrittenIsPlaceholder) {
    checks.push({
      name: "rewritten_placeholder_skipped",
      passed: true,
      message: "rewritten.html は明らかなプレースホルダーのため通常validate対象から除外しました",
      details: { articleDir, rewrittenPath },
    });
  }
}

if (original !== null && rewritten !== null && !rewrittenIsPlaceholder) {
  const originalTextLength = stripHtml(original).length;
  const rewrittenTextLength = stripHtml(rewritten).length;
  const lengthRatio = originalTextLength === 0 ? 1 : rewrittenTextLength / originalTextLength;
  addCheck("text_length_not_greatly_reduced", lengthRatio >= 0.9, "元記事より文字数が大きく減っていない", {
    originalTextLength,
    rewrittenTextLength,
    lengthRatio: Number(lengthRatio.toFixed(3)),
  });

  for (const level of [2, 3]) {
    const originalCount = countHeadings(original, level);
    const rewrittenCount = countHeadings(rewritten, level);
    const minAllowed = Math.max(0, Math.floor(originalCount * 0.8));
    addCheck(`h${level}_count_not_greatly_reduced`, rewrittenCount >= minAllowed, `H${level}の数が大きく減っていない`, {
      originalCount,
      rewrittenCount,
      minAllowed,
    });
  }

  for (const level of [2, 3]) {
    const ids = collectHeadingIds(rewritten, level);
    const dupes = duplicates(ids);
    addCheck(`h${level}_ids_unique`, dupes.length === 0, `H${level}のidが重複していない`, {
      ids,
      duplicates: dupes,
    });
  }

  const generatedArticleTocCount = (rewritten.match(/data-poipoi-decoration=["\']article-toc["\']/g) || []).length;
  const wakarukotoCount = generatedArticleTocCount === 1 ? 1 : countOccurrences(stripHtml(rewritten), "この記事でわかること");
  addCheck("wakarukoto_once", wakarukotoCount === 1, "「この記事でわかること」リストが1回だけ設置されている", {
    count: wakarukotoCount,
  });

  addCheck("html_not_severely_broken", !hasSevereHtmlBreakage(rewritten), "WordPressに貼り付け可能なHTMLとして大きく崩れていない");

  const requiredAnchorValidation = validateRequiredAnchors(rewritten, requiredLinks);
  addCheck("required_anchors_present", requiredAnchorValidation.ok, "必須アンカーテキストが指定URLで1回だけリンク化されている", {
    requiredLinkCount: requiredLinks.length,
    errors: requiredAnchorValidation.errors,
  });

  const wakaruCapboxes = wakarukotoCapboxes(rewritten);
  const wakaruCapboxesWithTable = wakaruCapboxes.filter((block) => /<table\b/i.test(block));
  addCheck("comparison_table_not_inside_wakarukoto_capbox", wakaruCapboxesWithTable.length === 0, "「この記事でわかること」のcapbox内に比較表が入っていない", { count: wakaruCapboxesWithTable.length });

  const emptyHeadings = emptyHeadingSections(rewritten);
  addCheck("empty_h2_h3_sections_not_excessive", emptyHeadings.length < 3, "本文のないH2/H3が一定数以上ない", { count: emptyHeadings.length, headings: emptyHeadings.map((section) => section.text) });

  const massHeadings = massGeneratedHeadings(rewritten);
  addCheck("number_only_mass_generated_headings_absent", massHeadings.length === 0, "数字だけ違う量産見出しがない", { groups: massHeadings });

  const duplicateH3Texts = h3DuplicateTexts(rewritten);
  addCheck("h3_texts_not_duplicated", duplicateH3Texts.length === 0, "同じH3文言が複数回出ていない", { duplicates: duplicateH3Texts });

  const unnaturalHits = unnaturalJapaneseHits(stripHtml(rewritten));
  addCheck("unnatural_japanese_phrases_absent", unnaturalHits.length === 0, "不自然な日本語表現がない", { hits: unnaturalHits });

  const paragraphTexts = collectParagraphTexts(rewritten);
  const exactDuplicateGroups = duplicateGroups(paragraphTexts, (text) => text);
  addCheck("p_tags_not_duplicated", exactDuplicateGroups.length === 0, "完全一致するpタグが2回以上ない", {
    duplicateCount: exactDuplicateGroups.length,
    duplicates: exactDuplicateGroups,
  });

  const topicIntroDuplicateGroups = highSimilarityGroups(
    paragraphTexts.filter((item) => /^[^。！？]{1,80}については、/u.test(item.text)),
    normalizeTopicIntroText,
    0.9,
  );
  addCheck("topic_intro_normalized_p_tags_not_duplicated", topicIntroDuplicateGroups.length === 0, "「〇〇については、」を除外した正規化本文が2回以上ない", {
    duplicateCount: topicIntroDuplicateGroups.length,
    duplicates: topicIntroDuplicateGroups,
  });

  const supplementDuplicateGroups = duplicateGroups(
    paragraphTexts.filter((item) => /^補足ポイント\s*[0-9０-９]+\s*[:：]/u.test(item.text)),
    normalizeSupplementText,
    40,
  );
  addCheck("supplement_number_normalized_p_tags_not_duplicated", supplementDuplicateGroups.length === 0, "「補足ポイント数字：」を除外した正規化本文が2回以上ない", {
    duplicateCount: supplementDuplicateGroups.length,
    duplicates: supplementDuplicateGroups,
  });

  const paragraphContexts = collectParagraphContexts(rewritten);
  const genericSafetySequences = consecutiveGenericSafetyAcrossH3(paragraphContexts);
  addCheck("generic_safety_text_not_repeated_across_consecutive_h3", genericSafetySequences.length === 0, "汎用安全文が複数H3に連続していない", {
    sequenceCount: genericSafetySequences.length,
    sequences: genericSafetySequences,
  });

  const supplementRuns = longSimilarSupplementRuns(paragraphTexts);
  addCheck("similar_supplements_not_mass_generated", supplementRuns.length === 0, "同一または高類似の補足文が10件以上並んでいない", {
    runCount: supplementRuns.length,
    runs: supplementRuns,
  });

  const comparisonBlockCount = (rewritten.match(/class=["'][^"']*comparison-table-block/gi) || []).length;
  addCheck("comparison_table_block_not_duplicated", comparisonBlockCount <= 1, "comparison-table-block が2つ以上ない", { count: comparisonBlockCount });

  const comparisonTables = tableBlocks(rewritten).filter(isComparisonTable);
  const needsComparison = likelyNeedsComparisonTable(rewritten);
  addCheck("comparison_table_not_duplicated", comparisonTables.length <= 1, "比較表が重複していない", {
    count: comparisonTables.length,
  });

  if (comparisonTables.length > 0) {
    const links = comparisonTables.flatMap(tableLinks);
    const missingTarget = links.filter((attrs) => !attrIncludes(attrs, "target", "_blank"));
    const missingRel = links.filter((attrs) => !attrIncludes(attrs, "rel", "noopener") || !attrIncludes(attrs, "rel", "noreferrer"));
    addCheck("comparison_table_links_have_target_blank", missingTarget.length === 0, "比較表内リンクに target=\"_blank\" が入っている", {
      linkCount: links.length,
      missingCount: missingTarget.length,
    });
    addCheck("comparison_table_links_have_rel", missingRel.length === 0, "比較表内リンクに rel=\"noopener noreferrer\" が入っている", {
      linkCount: links.length,
      missingCount: missingRel.length,
    });
    addCheck("comparison_table_has_no_empty_cells", !/<td[^>]*>\s*<\/td>/i.test(comparisonTables.join("\n")), "比較表に空のセルがない");

    const fallbackRatios = comparisonTables.map(fallbackRatioInTable);
    const lowQualityTables = fallbackRatios.filter((item) => item.ratio >= 0.5);
    addCheck("comparison_table_fallback_under_half", lowQualityTables.length === 0, "比較表の半数以上が「追加確認が必要」ではない", { fallbackRatios });

    const abstractItems = comparisonTables.flatMap(abstractComparisonItems);
    addCheck("comparison_table_has_no_abstract_heading_items", abstractItems.length === 0, "比較表にサービス名ではない抽象見出しが入っていない", { abstractItems });
  } else {
    checks.push({
      name: "comparison_table_presence_warning",
      passed: true,
      message: needsComparison ? "比較表が必要な可能性があります（未設置でも自動失敗にはしません）" : "比較表が不要な記事として扱います",
      details: { likelyNeedsComparisonTable: needsComparison },
    });
  }

}

const result = {
  ok: !hasError,
  generatedAt: new Date().toISOString(),
  files: { originalPath, rewrittenPath },
  checks,
};

await mkdir(articleDir, { recursive: true });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(`検証結果を保存しました: ${resultPath}`);
if (!result.ok) {
  console.error("検証に失敗した項目があります。");
  process.exit(1);
}
