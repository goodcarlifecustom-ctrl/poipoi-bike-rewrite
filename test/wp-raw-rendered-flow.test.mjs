import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const createScript = await readFile("scripts/create-wordpress-draft.mjs", "utf8");

test("create-wordpress-draft posts rewritten.html raw block markup and strips front matter", () => {
  assert.match(createScript, /const content = stripArticleFrontMatter\(await readFile\(rewrittenPath, "utf8"\)\);/);
  assert.match(createScript, /validateGutenbergBlocks\(content\)/);
  assert.match(createScript, /JSON\.stringify\(\{ title, content, status \}\)/);
  assert.doesNotMatch(createScript, /rendered\.html/);
});

test("rendered verification HTML is not treated as Gutenberg source", async () => {
  const rendered = await readFile("articles/sample-article/wordpress-draft-29300.rendered.html", "utf8");
  assert.doesNotMatch(rendered, /<!--\s*wp:/);
});

test("raw draft verification HTML is Gutenberg source markup", async () => {
  const raw = await readFile("articles/sample-article/wordpress-draft-29300.raw.html", "utf8");
  assert.match(raw, /<!--\s*wp:paragraph\s*-->/);
  assert.match(raw, /<!--\s*\/wp:paragraph\s*-->/);
});
