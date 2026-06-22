import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve("scripts/fix-internal-anchor-texts.mjs");

async function tempArticle(prefix, html) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  await writeFile(path.join(dir, "rewritten.html"), html, "utf8");
  return dir;
}

test("fixes internal anchor text to match target heading text", async () => {
  const dir = await tempArticle(
    "anchor-fix-",
    `<div class="cap_box" data-poipoi-decoration="article-toc"><div>この記事でわかること</div><ul><li><a href="#sell-method-comparison"><span>出張買取・一括査定・店舗持ち込みの違い</span></a></li></ul></div>\n<!-- wp:heading {"anchor":"sell-method-comparison"} -->
<h2 id="sell-method-comparison">ネオクラシックバイクを売る方法の比較</h2>
<!-- /wp:heading -->`,
  );

  const { stdout } = await execFileAsync(process.execPath, [scriptPath, dir]);
  const report = JSON.parse(stdout);
  const rewritten = await readFile(path.join(dir, "rewritten.html"), "utf8");
  const savedReport = JSON.parse(await readFile(path.join(dir, "anchor-link-report.json"), "utf8"));

  assert.equal(report.ok, true);
  assert.equal(report.articleDir, dir);
  assert.equal(report.checkedAnchorLinks, 1);
  assert.equal(report.matchedLinks, 0);
  assert.equal(report.fixedLinks, 1);
  assert.deepEqual(report.missingTargetIds, []);
  assert.equal(report.fixes[0].before, "出張買取・一括査定・店舗持ち込みの違い");
  assert.equal(report.fixes[0].after, "ネオクラシックバイクを売る方法の比較");
  assert.equal(savedReport.finalJudgement, "PASS");
  assert.match(rewritten, /<a href="#sell-method-comparison">ネオクラシックバイクを売る方法の比較<\/a>/);
});

test("accepts ARTICLE_DIR when no article directory argument is passed", async () => {
  const dir = await tempArticle("anchor-env-", `<a href="#target">違う文言</a><h3 id="target">正しい見出し</h3>`);

  const { stdout } = await execFileAsync(process.execPath, [scriptPath], { env: { ...process.env, ARTICLE_DIR: dir } });
  const report = JSON.parse(stdout);

  assert.equal(report.ok, true);
  assert.equal(report.articleDir, dir);
  assert.equal(report.fixedLinks, 1);
});

test("reports missing internal heading target ids as failures", async () => {
  const dir = await tempArticle("anchor-missing-", `<a href="#missing-id">存在しないリンク</a>`);

  await assert.rejects(async () => execFileAsync(process.execPath, [scriptPath, dir]), (error) => {
    const report = JSON.parse(error.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.finalJudgement, "FAIL");
    assert.equal(report.checkedAnchorLinks, 1);
    assert.equal(report.missingTargetIds[0].targetId, "missing-id");
    return true;
  });
});

test("reports duplicate heading ids, invalid targets, and empty text as failures", async () => {
  const dir = await tempArticle(
    "anchor-errors-",
    `<a href="#dup">重複ID</a><h2 id="dup">重複ID</h2><h3 id="dup">別見出し</h3>\n<a href="#non-heading">見出しではない</a><div id="non-heading">本文</div>\n<a href="#empty-anchor"></a><h4 id="empty-anchor">空アンカー先</h4>\n<a href="#empty-heading">空見出し</a><h2 id="empty-heading"></h2>`,
  );

  await assert.rejects(async () => execFileAsync(process.execPath, [scriptPath, dir]), (error) => {
    const report = JSON.parse(error.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.finalJudgement, "FAIL");
    assert.equal(report.duplicateHeadingIds[0].id, "dup");
    assert.equal(report.invalidTargetIds[0].targetId, "non-heading");
    assert.equal(report.emptyAnchorTexts[0].targetId, "empty-anchor");
    assert.equal(report.emptyHeadingTexts[0].id, "empty-heading");
    return true;
  });
});

test("fails when H2 exists but there are zero internal anchor links", async () => {
  const dir = await tempArticle("anchor-zero-", `<h2 id="target">買取相場</h2><p>本文です。</p>`);

  await assert.rejects(async () => execFileAsync(process.execPath, [scriptPath, dir]), (error) => {
    const report = JSON.parse(error.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.h2TargetCount, 1);
    assert.equal(report.checkedAnchorLinks, 0);
    assert.equal(report.finalJudgement, "FAIL");
    return true;
  });
});

test("fails when article toc li has no anchor tag", async () => {
  const dir = await tempArticle("anchor-linkless-toc-", `<div class="cap_box"><div>この記事でわかること</div><ul><li>買取相場</li></ul></div><h2 id="target">買取相場</h2>`);

  await assert.rejects(async () => execFileAsync(process.execPath, [scriptPath, dir]), (error) => {
    const report = JSON.parse(error.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.emptyArticleTocItems.length, 1);
    assert.equal(report.missingArticleTocLinks.length, 0);
    return true;
  });
});

test("create-wordpress-draft runs finalize before reading rewritten content", async () => {
  const source = await readFile(path.resolve("scripts/create-wordpress-draft.mjs"), "utf8");
  const finalizeIndex = source.indexOf('scripts/finalize-article.mjs');
  const readIndex = source.indexOf('const content = await readFile(rewrittenPath, "utf8")');
  assert.notEqual(finalizeIndex, -1);
  assert.notEqual(readIndex, -1);
  assert.equal(finalizeIndex < readIndex, true);
  assert.match(source, /記事の完成処理がFAILのためWordPress下書き作成を停止しました/);
});
