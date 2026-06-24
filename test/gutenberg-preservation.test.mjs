import assert from "node:assert/strict";
import test from "node:test";
import { decorateArticleHtml } from "../scripts/lib/article-decoration.mjs";
import { stripArticleFrontMatter, toGutenbergBlocks, validateGutenbergBlocks } from "../scripts/lib/gutenberg-blocks.mjs";

const heading = '<!-- wp:heading {"level":3,"anchor":"keep","className":"is-style-section","align":"wide","style":{"typography":{"fontSize":"24px"}},"backgroundColor":"vivid-red","textColor":"white","fontSize":"large"} -->\n<h3 class="wp-block-heading alignwide is-style-section has-white-color has-vivid-red-background-color has-text-color has-background has-large-font-size" id="keep">保持見出し</h3>\n<!-- /wp:heading -->';
const group = '<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"1rem"}}}} -->\n<div class="wp-block-group alignfull" style="padding-top:1rem"><!-- wp:heading {"anchor":"inside"} -->\n<h2 class="wp-block-heading" id="inside">内側見出し</h2>\n<!-- /wp:heading -->\n<!-- wp:paragraph {"fontSize":"small"} -->\n<p class="has-small-font-size">本文</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->';
const columns = '<!-- wp:columns {"verticalAlignment":"center"} -->\n<div class="wp-block-columns are-vertically-aligned-center"><!-- wp:column {"width":"33.33%"} -->\n<div class="wp-block-column" style="flex-basis:33.33%"><!-- wp:paragraph -->\n<p>左</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:column -->\n<!-- wp:column {"width":"66.66%"} -->\n<div class="wp-block-column" style="flex-basis:66.66%"><!-- wp:paragraph -->\n<p>右</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:column --></div>\n<!-- /wp:columns -->';
const custom = '<!-- wp:swell/balloon {"name":"店員","icon":"https://example.com/icon.png"} -->\n<div class="swell-block-balloon">独自ブロック</div>\n<!-- /wp:swell/balloon -->';
const htmlBlock = '<!-- wp:html -->\n<script type="application/ld+json">{"headline":"# 見出しではない","items":["- 箇条書きではない"]}</script><div data-ad="x">広告</div>\n<!-- /wp:html -->';

test("preserves JSON attributes and anchors on existing heading blocks byte-for-byte", () => {
  assert.equal(toGutenbergBlocks(heading), heading);
  assert.equal(decorateArticleHtml(heading, { sectionIndexes: [] }).html, heading);
});

test("preserves nested group, columns, custom blocks, and wp:html without converting them to html blocks", () => {
  const input = [group, columns, custom, htmlBlock].join("\n\n");
  const converted = toGutenbergBlocks(input).trimEnd();
  assert.equal(converted, input);
  assert.equal(decorateArticleHtml(input, { sectionIndexes: [] }).html, input);
  assert.match(converted, /<!-- wp:swell\/balloon /);
  assert.doesNotMatch(converted, /<!-- wp:html -->\n<!-- wp:swell\/balloon/);
  assert.match(converted, /<!-- wp:columns \{"verticalAlignment":"center"\} -->/);
});

test("existing Gutenberg blocks remain byte-identical after two passes", () => {
  const input = [heading, group, columns, custom, htmlBlock].join("\n\n");
  const once = toGutenbergBlocks(input).trimEnd();
  const twice = toGutenbergBlocks(once).trimEnd();
  assert.equal(once, input);
  assert.equal(twice, input);
});

test("front matter is retained for files but stripped for WordPress content", () => {
  const input = `---\ntitle: Sample\nslug: sample\n---\n<p>先頭ブロック</p>`;
  const converted = toGutenbergBlocks(input);
  assert.match(converted, /^---\ntitle: Sample\nslug: sample\n---\n<!-- wp:paragraph -->/);
  const content = stripArticleFrontMatter(converted);
  assert.doesNotMatch(content, /^---/);
  assert.match(content, /^<!-- wp:paragraph -->\n<p>先頭ブロック<\/p>/);
});

test("markdown validation ignores code, html, script, style, JSON-LD, URLs, and prose punctuation", () => {
  const input = `<!-- wp:paragraph -->\n<p>通常文章中の # 記号と - 記号、https://example.com/#hash はMarkdownではありません。</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:code -->\n<pre><code>## markdown-like code\n- item\n![alt](x.png)</code></pre>\n<!-- /wp:code -->\n\n<!-- wp:html -->\n<script type="application/ld+json">{"name":"## json","list":"- item"}</script><style>.x:before{content:"##"}</style>\n<!-- /wp:html -->`;
  assert.deepEqual(validateGutenbergBlocks(input), { ok: true, errors: [] });
});

test("markdown validation still fails for unconverted markdown body content", () => {
  const result = validateGutenbergBlocks(`<!-- wp:paragraph -->\n<p>ok</p>\n<!-- /wp:paragraph -->\n\n## 未変換見出し\n- 未変換リスト`);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("Markdown見出し")));
  assert.ok(result.errors.some((error) => error.includes("Markdown箇条書き")));
});
