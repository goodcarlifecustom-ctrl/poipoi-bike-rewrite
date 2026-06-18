import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve("scripts/fix-internal-anchor-texts.mjs");

test("fixes internal anchor text to match target heading text", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anchor-fix-"));
  await writeFile(
    path.join(dir, "rewritten.html"),
    `<ul><li><a href="#sell-method-comparison"><span>出張買取・一括査定・店舗持ち込みの違い</span></a></li></ul>\n<h2 id="sell-method-comparison">ネオクラシックバイクを売る方法の比較</h2>`,
    "utf8",
  );

  const { stdout } = await execFileAsync(process.execPath, [scriptPath, dir]);
  const report = JSON.parse(stdout);
  const rewritten = await readFile(path.join(dir, "rewritten.html"), "utf8");

  assert.equal(report.ok, true);
  assert.equal(report.checkedAnchorLinks, 1);
  assert.equal(report.matchedLinks, 0);
  assert.equal(report.fixedLinks, 1);
  assert.deepEqual(report.missingTargetIds, []);
  assert.equal(report.fixes[0].before, "出張買取・一括査定・店舗持ち込みの違い");
  assert.equal(report.fixes[0].after, "ネオクラシックバイクを売る方法の比較");
  assert.match(rewritten, /<a href="#sell-method-comparison">ネオクラシックバイクを売る方法の比較<\/a>/);
});

test("reports missing internal heading target ids as failures", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anchor-missing-"));
  await writeFile(path.join(dir, "rewritten.html"), `<a href="#missing-id">存在しないリンク</a>`, "utf8");

  await assert.rejects(async () => execFileAsync(process.execPath, [scriptPath, dir]), (error) => {
    const report = JSON.parse(error.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.finalJudgement, "FAIL");
    assert.equal(report.checkedAnchorLinks, 1);
    assert.equal(report.missingTargetIds[0].targetId, "missing-id");
    return true;
  });
});
