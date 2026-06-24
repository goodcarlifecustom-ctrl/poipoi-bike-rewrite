import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { decorateArticleHtml, validateDecorations } from "../scripts/lib/article-decoration.mjs";

const config = {
  articleTocTitle: "この記事でわかること",
  sectionIndexes: [{ h2Text: "売却の流れ", title: "この章でわかること", required: true }],
  contentLists: [{ selector: "ul.content-list", title: "ポイント一覧", required: false }],
  paragraph: { maxChars: 50, maxSentences: 3, targetSentencesPerParagraph: 2, shortParagraphChars: 1, shortParagraphRun: 10 },
  markers: { maxPerSection: 2, positiveKeywords: ["おすすめ", "査定"], negativeKeywords: ["注意", "確認"] },
};

const baseHtml = `<p>導入文です。</p>
<h2>売却の流れ</h2><p>査定は無料なのでおすすめです。</p><h3>準備</h3><p>書類確認に注意します。</p><h3>依頼</h3><p>査定を依頼します。</p>
<h2>注意点</h2><p>契約前に確認しましょう。</p>`;

function normalizeSerialized(html) {
  return html.replace(/\n{2,}/g, "\n");
}

function stripGeneratedText(html) {
  return html.replace(/<!--\s*\/?wp:[^>]+-->/g, "").replace(/<[^>]+>/g, "").replace(/この記事でわかること/g, "").replace(/A/g, "").replace(/\s+/g, "").trim();
}

test("全H2から記事目次が生成される", () => {
  const { html, report } = decorateArticleHtml(baseHtml, config);
  assert.equal(report.errors.length, 0, report.errors.join(";"));
  assert.equal((html.match(/data-poipoi-decoration="article-toc"/g) || []).length, 1);
  assert.equal((html.match(/<li><a href="#sec-/g) || []).length >= 2, true);
});

test("H2のIDがない場合にIDが付く", () => {
  const { html } = decorateArticleHtml("<h2>タイトル</h2><p>査定がおすすめです。</p>", { ...config, sectionIndexes: [] });
  assert.match(html, /<!-- wp:heading {"anchor":"sec-01"} -->\n<h2 class="wp-block-heading" id="sec-01">タイトル<\/h2>\n<!-- \/wp:heading -->/);
});

test("重複IDが修正される", () => {
  const { html } = decorateArticleHtml('<h2 id="dup">A</h2><p>査定。</p><h2 id="dup">B</h2><p>確認。</p>', { ...config, sectionIndexes: [] });
  assert.match(html, /<h2 class="wp-block-heading" id="sec-01">A<\/h2>/);
  assert.match(html, /<h2 class="wp-block-heading" id="sec-02">B<\/h2>/);
  assert.equal(validateDecorations(html, { ...config, sectionIndexes: [] }).ok, true);
});


test("既存sec IDは見出し追加や文言変更で振り直さない", () => {
  const source = `<div class="cap_box" data-poipoi-decoration="article-toc"><div class="cap_box_ttl"><span>この記事でわかること</span></div><div class="cap_box_content"><ul><li><a href="#sec-01">既存Aの新文言</a></li><li><a href="#sec-03">既存B</a></li></ul></div></div><h2>途中追加</h2><p>本文。</p><h2 id="sec-01">既存Aの新文言</h2><p>本文。</p><h2 id="sec-03">既存B</h2><p>本文。</p>`;
  const { html } = decorateArticleHtml(source, { ...config, sectionIndexes: [], markers: { maxPerSection: 0, positiveKeywords: [], negativeKeywords: [] } });
  assert.match(html, /<a href="#sec-01">既存Aの新文言<\/a>/);
  assert.match(html, /<a href="#sec-03">既存B<\/a>/);
  assert.match(html, /<h2 class="wp-block-heading">途中追加<\/h2>/);
  assert.doesNotMatch(html, /href="#sec-02">途中追加/);
});

test("既存TOCに含まれないH2はTOCリンク対象へ追加しない", () => {
  const source = `<div class="cap_box"><div class="cap_box_ttl"><span>この記事でわかること</span></div><div class="cap_box_content"><ul><li><a href="#sec-01">リンク対象</a></li></ul></div></div><h2 id="sec-01">リンク対象</h2><p>本文。</p><h2>対象外H2</h2><p>本文。</p>`;
  const { html } = decorateArticleHtml(source, { ...config, sectionIndexes: [], markers: { maxPerSection: 0, positiveKeywords: [], negativeKeywords: [] } });
  const toc = html.match(/data-poipoi-decoration="article-toc"[\s\S]*?<\/ul>/)?.[0] || "";
  assert.equal((toc.match(/<li><a href="#sec-/g) || []).length, 1);
  assert.doesNotMatch(toc, /対象外H2/);
  assert.match(html, /<h2 class="wp-block-heading">対象外H2<\/h2>/);
});

test("目次リンク先がすべて存在する", () => {
  const { html } = decorateArticleHtml(baseHtml, config);
  assert.equal(validateDecorations(html, config).ok, true);
});

test("H3一覧のリンク先IDが存在する", () => {
  const { html } = decorateArticleHtml(baseHtml, config);
  assert.match(html, /data-poipoi-decoration="section-index-text-/);
  assert.equal(validateDecorations(html, config).ok, true);
});

test("hrefだけありH3 IDがないHTMLは検証エラーになる", () => {
  const bad = '<div class="cap_box" data-poipoi-decoration="article-toc"><div class="cap_box_content"><ul><li><a href="#x">A</a></li></ul></div></div><h2 id="h2-a-1">A</h2><p>Intro</p><div class="cap_box" data-poipoi-decoration="section-index-text-a"><div class="cap_box_content"><ul><li><a href="#missing">B</a></li></ul></div></div><h3>B</h3><p>査定。</p>';
  const validation = validateDecorations(bad, { ...config, sectionIndexes: [{ h2Text: "A", title: "A", required: true }] });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(";"), /IDがないH3|リンク先IDが存在しません/);
});

test("対象リストがcapboxで1回だけ囲まれ、2回目でもliとテキストが残る", () => {
  const first = decorateArticleHtml('<h2>A</h2><p>査定。</p><ul class="content-list"><li>One</li><li>Two</li></ul>', { ...config, sectionIndexes: [] }).html;
  const second = decorateArticleHtml(first, { ...config, sectionIndexes: [] }).html;
  assert.equal((second.match(/data-poipoi-decoration="content-list"/g) || []).length, 1);
  const contentListBlock = second.match(/data-poipoi-decoration="content-list"[\s\S]*?<\/ul>/)?.[0] || "";
  assert.equal((contentListBlock.match(/<li>/g) || []).length, 2);
  assert.match(second, /One/);
  assert.match(second, /Two/);
  assert.equal(validateDecorations(second, { ...config, sectionIndexes: [] }).ok, true);
});

test("required=true の contentLists selector が0件ならエラー", () => {
  const { report } = decorateArticleHtml('<h2>A</h2><p>査定。</p>', { ...config, sectionIndexes: [], contentLists: [{ selector: "ul.must", title: "必須", required: true }] });
  assert.match(report.errors.join(";"), /必須contentLists selector/);
});

test("required=true の sectionIndexes 対象H2がない場合はエラー", () => {
  const { report } = decorateArticleHtml('<h2>A</h2><p>査定。</p>', { ...config, sectionIndexes: [{ h2Text: "Missing", title: "Missing", required: true }] });
  assert.match(report.errors.join(";"), /対象H2が見つかりません/);
});

test("2回実行しても出力が重複しない", () => {
  const first = decorateArticleHtml(baseHtml, config).html;
  const second = decorateArticleHtml(first, config).html;
  assert.equal((second.match(/data-poipoi-decoration="article-toc"/g) || []).length, 1);
  assert.equal((second.match(/data-poipoi-decoration="section-index-text-/g) || []).length, 1);
});

test("長い段落が分割され本文テキストは変わらない", () => {
  const text = "一文目です。二文目です。三文目です。四文目です。五文目です。";
  const { html, report } = decorateArticleHtml(`<h2>A</h2><p>${text}</p>`, { ...config, sectionIndexes: [], paragraph: { ...config.paragraph, maxChars: 20, maxSentences: 2 }, markers: { maxPerSection: 0, positiveKeywords: [], negativeKeywords: [] } });
  assert.equal(report.splitParagraphCount, 1);
  assert.equal(stripGeneratedText(html), text.replace(/\s+/g, ""));
});

test("既存マーカーが解除されてから再適用される", () => {
  const { html, report } = decorateArticleHtml('<h2>A</h2><p><span class="swl-marker mark_yellow">査定</span>はおすすめです。</p>', { ...config, sectionIndexes: [] });
  assert.equal(report.removedMarkerCount, 1);
  assert.equal(report.newMarkerCount >= 1, true);
  assert.equal((html.match(/swl-marker/g) || []).length, 1);
});

test("空マーカーがエラーになる", () => {
  const bad = '<div class="cap_box" data-poipoi-decoration="article-toc"><div class="cap_box_content"><ul><li><a href="#a">A</a></li></ul></div></div><h2 id="a">A</h2><p><span class="swl-marker mark_yellow"></span>本文</p>';
  const validation = validateDecorations(bad, { ...config, sectionIndexes: [] });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(";"), /空のマーカー/);
});

test("1見出しにつき最大2マーカーを超えない", () => {
  const { html } = decorateArticleHtml('<h2>A</h2><p>査定がおすすめです。</p><p>確認に注意です。</p><p>査定がおすすめです。</p>', { ...config, sectionIndexes: [] });
  const validation = validateDecorations(html, { ...config, sectionIndexes: [] });
  assert.equal(validation.ok, true, validation.errors.join(";"));
  assert.equal(validation.metrics.markerCount <= 2, true);
});

test("キーワード候補がない通常本文にもフォールバックでマーカーが入る", () => {
  const { report } = decorateArticleHtml('<h2>A</h2><p>これは通常本文として重要な説明を含む文章です。</p>', { ...config, sectionIndexes: [], markers: { maxPerSection: 2, positiveKeywords: [], negativeKeywords: [] } });
  assert.equal(report.eligibleSectionCount, 1);
  assert.equal(report.markedSectionCount, 1);
  assert.deepEqual(report.unmarkedSections, []);
});

test("WordPressブロックコメントが壊れない", () => {
  const { html } = decorateArticleHtml(baseHtml, config);
  assert.match(html, /<!-- wp:paragraph -->/);
  assert.match(html, /<!-- \/wp:paragraph -->/);
});

test("実際のrewritten.htmlを使った統合テスト", async () => {
  const real = await readFile("articles/sample-article/rewritten.html", "utf8");
  const { html, report } = decorateArticleHtml(real, { ...config, sectionIndexes: [] });
  assert.equal(report.errors.length, 0, report.errors.join(";"));
  assert.equal(validateDecorations(html, { ...config, sectionIndexes: [] }).ok, true);
});

for (const fixture of ["neoclassic", "bike-geinin"]) {
  test(`${fixture} fixture integration`, async () => {
    const source = await readFile(`test/fixtures/${fixture}.html`, "utf8");
    const fixtureConfig = {
      ...config,
      sectionIndexes: [{ h2Text: fixture === "neoclassic" ? "ネオクラシックバイクの買取相場" : "バイク芸人の愛車が注目される理由", title: "この章でわかること", required: true }],
      contentLists: fixture === "bike-geinin" ? [{ selector: "ul.content-list", title: "ポイント一覧", required: true }] : [],
      paragraph: { ...config.paragraph, shortParagraphChars: 4, shortParagraphRun: 4 },
    };
    const first = decorateArticleHtml(source, fixtureConfig);
    const second = decorateArticleHtml(first.html, fixtureConfig);
    assert.equal(first.report.errors.filter((e) => !/極端に短い連続段落/.test(e)).length, 0, first.report.errors.join(";"));
    assert.equal(normalizeSerialized(second.html), normalizeSerialized(first.html));
    const validation = validateDecorations(first.html, fixtureConfig);
    assert.equal(validation.metrics.articleTocLinkCount, validation.metrics.h2Count);
    assert.equal(validation.metrics.h3Indexes.every((item) => item.h3Count === item.linkCount), true);
    assert.doesNotMatch(first.html, /既存メモ[\s\S]*<\/div>\s*<\/div>\s*<\/div>/);
    assert.match(first.html, fixture === "neoclassic" ? /ネオクラシックは年式と純正度を確認/ : /査定前に写真を撮る/);
    assert.equal(first.report.removedMarkerCount >= 1, true);
    if (fixture === "neoclassic") assert.match(first.report.errors.join(";"), /極端に短い連続段落/);
  });
}

test("統合コマンドを2回実行しても2回目のrewritten.htmlは同一", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "poipoi-finalize-test-"));
  const articleDir = path.join(dir, "article");
  await mkdir(articleDir, { recursive: true });
  await writeFile(path.join(articleDir, "original.html"), baseHtml, "utf8");
  await writeFile(path.join(articleDir, "rewritten.html"), baseHtml, "utf8");
  await writeFile(path.join(articleDir, "article-decoration.json"), JSON.stringify(config), "utf8");
  try {
    const firstRun = spawnSync(process.execPath, ["scripts/finalize-article.mjs", articleDir], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
    const first = await readFile(path.join(articleDir, "rewritten.html"), "utf8");
    const secondRun = spawnSync(process.execPath, ["scripts/finalize-article.mjs", articleDir], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
    const second = await readFile(path.join(articleDir, "rewritten.html"), "utf8");
    const anchorReport = JSON.parse(await readFile(path.join(articleDir, "anchor-link-report.json"), "utf8"));
    assert.equal(anchorReport.finalJudgement, "PASS");
    assert.equal(anchorReport.articleDir, articleDir);
    assert.equal(normalizeSerialized(second), normalizeSerialized(first));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finalize generates three article toc anchors for three H2 headings", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "poipoi-finalize-three-h2-"));
  const articleDir = path.join(dir, "article");
  const html = "<p>導入文です。査定の概要を説明します。</p><h2>買取相場</h2><p>査定額の目安です。</p><h2>高く売るコツ</h2><p>確認して準備します。</p><h2>必要書類</h2><p>書類を用意します。</p>";
  await mkdir(articleDir, { recursive: true });
  await writeFile(path.join(articleDir, "original.html"), html, "utf8");
  await writeFile(path.join(articleDir, "rewritten.html"), html, "utf8");
  await writeFile(path.join(articleDir, "article-decoration.json"), JSON.stringify({ ...config, sectionIndexes: [], markers: { maxPerSection: 0, positiveKeywords: [], negativeKeywords: [] } }), "utf8");
  try {
    const run = spawnSync(process.execPath, ["scripts/finalize-article.mjs", articleDir], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const rewritten = await readFile(path.join(articleDir, "rewritten.html"), "utf8");
    const toc = rewritten.match(/data-poipoi-decoration="article-toc"[\s\S]*?<\/ul>/)?.[0] || "";
    assert.equal((toc.match(/<li><a href="#/g) || []).length, 3);
    const report = JSON.parse(await readFile(path.join(articleDir, "anchor-link-report.json"), "utf8"));
    assert.equal(report.articleTocLinkCount, 3);
    assert.equal(report.finalJudgement, "PASS");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finalize replaces handmade linkless article toc with linked toc", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "poipoi-finalize-handmade-toc-"));
  const articleDir = path.join(dir, "article");
  const html = '<div class="cap_box"><div class="cap_box_ttl"><span>この記事でわかること</span></div><div class="cap_box_content"><ul><li>古い項目</li></ul></div></div><h2>買取相場</h2><p>査定の説明です。</p><h2>必要書類</h2><p>確認事項です。</p>';
  await mkdir(articleDir, { recursive: true });
  await writeFile(path.join(articleDir, "original.html"), html, "utf8");
  await writeFile(path.join(articleDir, "rewritten.html"), html, "utf8");
  await writeFile(path.join(articleDir, "article-decoration.json"), JSON.stringify({ ...config, sectionIndexes: [], markers: { maxPerSection: 0, positiveKeywords: [], negativeKeywords: [] } }), "utf8");
  try {
    const run = spawnSync(process.execPath, ["scripts/finalize-article.mjs", articleDir], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const rewritten = await readFile(path.join(articleDir, "rewritten.html"), "utf8");
    assert.equal((rewritten.match(/この記事でわかること/g) || []).length, 1);
    assert.doesNotMatch(rewritten, /古い項目/);
    assert.equal((rewritten.match(/<li><a href="#/g) || []).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
