#!/usr/bin/env node
import { mkdtemp, readFile, rename, rm, writeFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { decorateArticleHtml, loadArticleDecorationConfig, validateDecorations } from "./lib/article-decoration.mjs";

const articleDir = process.argv[2] || "articles/sample-article";
const rewrittenPath = join(articleDir, "rewritten.html");
const runReportPath = join(articleDir, "decoration-run-report.json");
const validationReportPath = join(articleDir, "decoration-validation-report.json");
const source = await readFile(rewrittenPath, "utf8");
const config = await loadArticleDecorationConfig("rules/article-decoration.json", articleDir);
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

  const atomicPath = join(articleDir, `.rewritten.${process.pid}.tmp`);
  await writeFile(atomicPath, await readFile(tempRewrittenPath, "utf8"), "utf8");
  await rename(atomicPath, rewrittenPath);
  await writeFile(runReportPath, `${JSON.stringify(decorated.report, null, 2)}\n`, "utf8");
  await writeFile(validationReportPath, `${JSON.stringify(decorationValidationReport, null, 2)}\n`, "utf8");
  console.log(`統合完成処理に成功しました: ${rewrittenPath}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
