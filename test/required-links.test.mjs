import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureRequiredAnchors, validateRequiredAnchors } from "../scripts/lib/required-links.mjs";

const required = [{ anchor: "バイク買取MAX", url: "https://poi-poi.co.jp/bike/", kind: "internal" }];

test("必須アンカーが本文にある場合はリンク化される", () => {
  const html = "<p>バイク買取MAXで査定できます。</p>";
  const result = ensureRequiredAnchors(html, required);
  assert.match(result, /<a href="https:\/\/poi-poi\.co\.jp\/bike\/">バイク買取MAX<\/a>/);
  assert.equal(validateRequiredAnchors(result, required).ok, true);
});

test("すでにリンク済みなら二重リンクにしない", () => {
  const html = '<p><a href="https://poi-poi.co.jp/bike/">バイク買取MAX</a>で査定できます。バイク買取MAXも候補です。</p>';
  const result = ensureRequiredAnchors(html, required);
  assert.equal((result.match(/<a\b/g) || []).length, 1);
  assert.equal(result, html);
});

test("見出し内はリンク化しない", () => {
  const html = "<h2>バイク買取MAXの特徴</h2><p>別の本文です。</p>";
  const result = ensureRequiredAnchors(html, required);
  assert.equal(result, html);
  assert.equal(validateRequiredAnchors(result, required).ok, false);
});

test("必須リンクが入らなければエラーになる", () => {
  const html = "<p>本文に対象アンカーがありません。</p>";
  const validation = validateRequiredAnchors(ensureRequiredAnchors(html, required), required);
  assert.equal(validation.ok, false);
  assert.match(validation.errors[0], /必須リンクがありません/);
});

test("テーブルの『公式情報で確認』がリンク化される", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "poipoi-table-"));
  const articleDir = path.join(dir, "article");
  await mkdir(articleDir, { recursive: true });
  const html = `
    <h2>おすすめバイク買取業者の比較</h2>
    <h3>バイク買取MAX</h3>
    <p>特徴は出張査定に対応していることです。査定料や出張料は無料です。高く売りたい人におすすめです。契約条件は確認しましょう。<a href="https://poi-poi.co.jp/bike/">公式情報で確認</a></p>
    <h3>公式バイク査定サービス</h3>
    <p>特徴は全国対応の査定サービスです。手数料は無料です。原付を売りたい人にもおすすめです。キャンセル条件は確認しましょう。<a href="https://example.com/bike">公式情報で確認</a></p>
  `;
  await writeFile(path.join(articleDir, "rewritten.html"), html, "utf8");
  const result = spawnSync(process.execPath, ["scripts/build-comparison-table.mjs", articleDir], { cwd: process.cwd(), encoding: "utf8" });
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const rewritten = await readFile(path.join(articleDir, "rewritten.html"), "utf8");
    assert.match(rewritten, /<td><a href="https:\/\/poi-poi\.co\.jp\/bike\/" target="_blank" rel="noopener noreferrer">公式情報で確認<\/a><\/td>/);
    assert.match(rewritten, /<td><a href="https:\/\/example\.com\/bike" target="_blank" rel="noopener noreferrer">公式情報で確認<\/a><\/td>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
