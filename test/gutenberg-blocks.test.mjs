import assert from "node:assert/strict";
import test from "node:test";
import { toGutenbergBlocks, validateGutenbergBlocks } from "../scripts/lib/gutenberg-blocks.mjs";

test("converts common article HTML to WordPress serialized blocks", () => {
  const input = `---\ntitle: Sample\nslug: sample\n---\n<p><a href="https://example.com">本文</a></p><h2 id="sec">見出し</h2><ul><li>項目</li></ul><figure><img src="https://example.com/a.jpg" alt="代替"/><figcaption>説明</figcaption></figure><table><tbody><tr><td>項目</td><td>内容</td></tr></tbody></table><blockquote><p>引用</p></blockquote><pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>`;
  const out = toGutenbergBlocks(input);
  assert.match(out, /^---\ntitle: Sample\nslug: sample\n---/);
  assert.match(out, /<!-- wp:paragraph -->\n<p><a href="https:\/\/example.com">本文<\/a><\/p>\n<!-- \/wp:paragraph -->/);
  assert.match(out, /<!-- wp:heading \{"anchor":"sec"\} -->\n<h2 class="wp-block-heading" id="sec">見出し<\/h2>\n<!-- \/wp:heading -->/);
  assert.match(out, /<!-- wp:list -->[\s\S]*<ul class="wp-block-list">[\s\S]*<!-- wp:list-item -->\n<li>項目<\/li>/);
  assert.match(out, /<!-- wp:image \{"sizeSlug":"large","linkDestination":"none"\} -->[\s\S]*src="https:\/\/example.com\/a.jpg" alt="代替"/);
  assert.match(out, /<!-- wp:table -->[\s\S]*<figure class="wp-block-table"><table>/);
  assert.match(out, /<!-- wp:quote -->/);
  assert.match(out, /<!-- wp:code -->/);
  assert.equal(validateGutenbergBlocks(out).ok, true);
});

test("is idempotent and does not double wrap existing Gutenberg blocks", () => {
  const input = `<!-- wp:paragraph -->\n<p>本文です。</p>\n<!-- /wp:paragraph -->\n\n<h3>小見出し</h3>`;
  const once = toGutenbergBlocks(input);
  const twice = toGutenbergBlocks(once);
  assert.equal(twice, once);
  assert.equal((twice.match(/<!-- wp:paragraph -->/g) || []).length, 1);
  assert.match(twice, /<!-- wp:heading \{"level":3\} -->\n<h3 class="wp-block-heading">小見出し<\/h3>/);
});

test("reports unbalanced blocks and leftover markdown", () => {
  const result = validateGutenbergBlocks(`<!-- wp:paragraph -->\n<p>x</p>\n## bad`);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes("未終了")));
  assert.ok(result.errors.some(e => e.includes("Markdown見出し")));
});
