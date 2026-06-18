import test from "node:test";
import assert from "node:assert/strict";
import { selectPrimaryExternalLink, validateIntroExternalLink } from "../scripts/lib/intro-external-link.mjs";

const introLink = (url, anchor) => `<p>メーカー公式サイトの<a href="${url}" target="_blank" rel="noopener noreferrer">${anchor}</a>では、仕様や対応情報を確認できます。本記事では特徴と売却時の見方を解説します。</p>`;

test("外部リンクが1件あり元記事の本文後半にある場合、出力では最初のH2より前の導入文に配置される", () => {
  const original = `<h1>CBR250RRの買取</h1><h2>特徴</h2><p>後半で<a href="https://www.honda.co.jp/CBR250RR/">CBR250RR製品情報</a>を紹介します。</p>`;
  const rewritten = `<h1>CBR250RRの買取</h1>${introLink("https://www.honda.co.jp/CBR250RR/", "CBR250RR製品情報")}<h2>特徴</h2><p>本文です。</p>`;
  assert.equal(validateIntroExternalLink(original, rewritten).ok, true);
});

test("外部リンクがすでに導入文にある場合、不要な移動や重複が発生しない", () => {
  const original = `<h1>ヤマハXSR</h1><p>ヤマハ公式の<a href="https://www.yamaha-motor.co.jp/mc/lineup/xsr/">XSR製品情報</a>を確認できます。</p><h2>概要</h2>`;
  const rewritten = `<h1>ヤマハXSR</h1><p>ヤマハ公式の<a href="https://www.yamaha-motor.co.jp/mc/lineup/xsr/" target="_blank" rel="noopener noreferrer">XSR製品情報</a>を確認しながら、買取相場や査定ポイントを整理します。</p><h2>概要</h2>`;
  assert.equal(validateIntroExternalLink(original, rewritten).ok, true);
});

test("同じ外部リンクが複数箇所にある場合、不要な重複が検出される", () => {
  const original = `<h1>バイク手続き</h1><p><a href="https://www.mlit.go.jp/">国土交通省の手続き情報</a></p>`;
  const rewritten = `<h1>バイク手続き</h1>${introLink("https://www.mlit.go.jp/", "国土交通省の手続き情報")}<h2>手続き</h2><p><a href="https://www.mlit.go.jp/">国土交通省の手続き情報</a>も参照します。</p>`;
  const result = validateIntroExternalLink(original, rewritten);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(";"), /重複/);
});

test("外部リンクが複数ある場合、記事テーマに最も関連性が高い公式リンクが導入文対象に選ばれる", () => {
  const original = `<h1>CBR250RRの買取相場</h1><p><a href="https://example.com/blog">参考ブログ</a></p><p><a href="https://www.honda.co.jp/CBR250RR/">メーカー公式CBR250RR製品情報</a></p>`;
  const selected = selectPrimaryExternalLink(original);
  assert.equal(selected.url, "https://www.honda.co.jp/CBR250RR/");
});

test("外部リンクがない場合、存在しないURLを要求しない", () => {
  const original = `<h1>原付買取</h1><p>外部リンクなし。</p>`;
  const rewritten = `<h1>原付買取</h1><p>原付買取の流れを解説します。</p><h2>流れ</h2>`;
  const result = validateIntroExternalLink(original, rewritten);
  assert.equal(result.ok, true);
  assert.equal(result.target, null);
});

test("front matter、H1、複数のH2を壊さず、最初のH2より前にリンクが入る", () => {
  const original = `---\ntitle: テスト\n---\n<h1>レブル250</h1><h2>概要</h2><p><a href="https://www.honda.co.jp/Rebel250/">レブル250製品情報</a></p><h2>査定</h2>`;
  const rewritten = `---\ntitle: テスト\n---\n<h1>レブル250</h1>${introLink("https://www.honda.co.jp/Rebel250/", "レブル250製品情報")}<h2>概要</h2><p>本文</p><h2>査定</h2>`;
  assert.equal(validateIntroExternalLink(original, rewritten).ok, true);
  assert.match(rewritten, /^---\ntitle: テスト\n---\n<h1>/);
});

test("元記事が導入文なしでタイトル直後からH2で始まる場合、タイトルと最初のH2の間の導入文リンクを通す", () => {
  const original = `<h1>Ninja 400</h1><h2>スペック</h2><p><a href="https://www.kawasaki-motors.com/mc/lineup/ninja400/">Ninja 400製品情報</a></p>`;
  const rewritten = `<h1>Ninja 400</h1>${introLink("https://www.kawasaki-motors.com/mc/lineup/ninja400/", "Ninja 400製品情報")}<h2>スペック</h2><p>本文</p>`;
  assert.equal(validateIntroExternalLink(original, rewritten).ok, true);
});

