#!/usr/bin/env node
import { mkdtemp, readFile, rename, rm, writeFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { decorateArticleHtml, loadArticleDecorationConfig, validateDecorations } from "./lib/article-decoration.mjs";
import { toGutenbergBlocks, validateGutenbergBlocks } from "./lib/gutenberg-blocks.mjs";

const articleDir = process.argv[2] || "articles/sample-article";
const rewrittenPath = join(articleDir, "rewritten.html");
const runReportPath = join(articleDir, "decoration-run-report.json");
const validationReportPath = join(articleDir, "decoration-validation-report.json");
const anchorReportPath = join(articleDir, "anchor-link-report.json");
const source = await readFile(rewrittenPath, "utf8");
const config = await loadArticleDecorationConfig("rules/article-decoration.json", articleDir);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function copyAnchorReportFromTemp(tempAnchorReportPath) {
  const report = JSON.parse(await readFile(tempAnchorReportPath, "utf8"));
  report.articleDir = articleDir;
  await writeFile(anchorReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
const tempRoot = await mkdtemp(join(tmpdir(), "poipoi-finalize-"));
try {
  const tempArticleDir = join(tempRoot, "article");
  await cp(articleDir, tempArticleDir, { recursive: true });
  const tempRewrittenPath = join(tempArticleDir, "rewritten.html");

  const decorated = decorateArticleHtml(source, config);
  if (decorated.report.errors.length > 0) {
    await writeFile(runReportPath, `${JSON.stringify(decorated.report, null, 2)}\n`, "utf8");
    throw new Error(`decorate failed: ${decorated.report.errors.join("; ")}`);
  }
  await writeFile(tempRewrittenPath, decorated.html, "utf8");

  const decorationValidation = validateDecorations(decorated.html, config);
  const decorationValidationReport = { ...decorationValidation.metrics, errors: decorationValidation.errors };
  if (!decorationValidation.ok) {
    await writeFile(runReportPath, `${JSON.stringify(decorated.report, null, 2)}\n`, "utf8");
    await writeFile(validationReportPath, `${JSON.stringify(decorationValidationReport, null, 2)}\n`, "utf8");
    throw new Error(`validate decorations failed: ${decorationValidation.errors.join("; ")}`);
  }

  const validate = spawnSync(process.execPath, [resolve("scripts/validate-rewritten.mjs"), tempArticleDir], { encoding: "utf8" });
  if (validate.status !== 0) {
    throw new Error(`existing validate failed: ${validate.stderr || validate.stdout}`);
  }

  const anchorFix = spawnSync(process.execPath, [resolve("scripts/fix-internal-anchor-texts.mjs"), tempArticleDir], { encoding: "utf8" });
  const tempAnchorReportPath = join(tempArticleDir, "anchor-link-report.json");
  if (anchorFix.status !== 0) {
    try {
      await copyAnchorReportFromTemp(tempAnchorReportPath);
    } catch {
      // If report creation failed before the file was written, include process output in the thrown error instead.
    }
    throw new Error(`internal anchor validation failed: ${anchorFix.stderr || anchorFix.stdout}`);
  }

  const finalizedHtml = toGutenbergBlocks(await readFile(tempRewrittenPath, "utf8"));
  const gutenbergValidation = validateGutenbergBlocks(finalizedHtml);
  if (!gutenbergValidation.ok) {
    throw new Error(`Gutenbergブロック検証に失敗しました: ${gutenbergValidation.errors.join("; ")}`);
  }
  await writeFile(tempRewrittenPath, finalizedHtml, "utf8");

  const atomicPath = join(articleDir, `.rewritten.${process.pid}.tmp`);
  await writeFile(atomicPath, finalizedHtml, "utf8");
  await rename(atomicPath, rewrittenPath);
  decorated.report.observation = {
    generatedRewrittenSha256: sha256(source),
    beforeFinalizeSha256: sha256(source),
    afterFinalizeSha256: sha256(finalizedHtml),
    gutenbergBlocks: true,
  };
  await writeFile(runReportPath, `${JSON.stringify(decorated.report, null, 2)}\n`, "utf8");
  await writeFile(validationReportPath, `${JSON.stringify(decorationValidationReport, null, 2)}\n`, "utf8");
  await copyAnchorReportFromTemp(join(tempArticleDir, "anchor-link-report.json"));
  console.log(`統合完成処理に成功しました: ${rewrittenPath}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
