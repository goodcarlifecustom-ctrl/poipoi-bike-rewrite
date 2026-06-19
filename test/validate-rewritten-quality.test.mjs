import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const baseOriginal = '<p>導入です。</p><div data-poipoi-decoration="article-toc">この記事でわかること</div><h2 id="main">主要情報</h2><p>主要情報、固有名詞、検索意図を保持します。</p><h2 id="summary">まとめ</h2><p>まとめます。</p>';

async function runValidation(rewritten, original = baseOriginal) {
  const dir = await mkdtemp(path.join(tmpdir(), "poipoi-validate-quality-"));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "original.html"), original, "utf8");
  await writeFile(path.join(dir, "rewritten.html"), rewritten, "utf8");
  const run = spawnSync(process.execPath, ["scripts/validate-rewritten.mjs", dir], { cwd: process.cwd(), encoding: "utf8" });
  const report = JSON.parse(await readFile(path.join(dir, "validation-result.json"), "utf8"));
  await rm(dir, { recursive: true, force: true });
  return { run, report };
}

function shell() {
  return '<p>導入です。</p><div data-poipoi-decoration="article-toc">この記事でわかること</div><h2 id="main">主要情報</h2>';
}

function close() {
  return '<h2 id="summary">まとめ</h2><p>主要情報を整理します。</p>';
}

function check(report, name) {
  return report.checks.find((item) => item.name === name);
}

test("A: 18車種に同じ文章を付けた記事がFAILする", async () => {
  const body = Array.from({ length: 18 }, (_, index) => {
    const name = `車種${index + 1}`;
    return `<h3>${name}</h3><p>${name}を選ぶときは、見た目だけでなく乗車姿勢、足つき、整備履歴、保険や税金を含めた維持費まで確認しましょう。乗り換え前提なら、純正状態に近い個体や人気色は125cc バイク 査定で評価されやすい点も覚えておくと安心です。</p>`;
  }).join("");
  const { run, report } = await runValidation(`${shell()}${body}${close()}`);
  assert.notEqual(run.status, 0);
  assert.equal(check(report, "topic_intro_normalized_p_tags_not_duplicated").passed, false);
});

test("B: 地域名と補足番号だけが違う文章が3件以上ある記事がFAILする", async () => {
  const body = ["津", "四日市", "伊勢"].map((area, index) => `<h3>${area}市</h3><p>${area}市でバイク買取を相談する場合は、保管場所の道幅、駐輪場の位置、エンジン始動可否、鍵と書類の有無を先に伝えると、三重県内の出張査定日程を調整しやすくなります。補足${index + 1}として、査定額だけでなく引き取り条件も確認しましょう。</p>`).join("");
  const { run, report } = await runValidation(`${shell()}${body}${close()}`);
  assert.notEqual(run.status, 0);
  assert.equal(check(report, "supplement_number_normalized_p_tags_not_duplicated").passed, false);
});

test("C: 固有段落と共通段落が交互に並んでいてもFAILする", async () => {
  const body = ["津", "四日市", "伊勢"].map((area, index) => `<h3>${area}市</h3><p>${area}市の主要道路や店舗分布は地域ごとに異なります。</p><p>${area}市でバイク買取を相談する場合は、保管場所の道幅、駐輪場の位置、エンジン始動可否、鍵と書類の有無を先に伝えると、三重県内の出張査定日程を調整しやすくなります。補足${index + 1}として、査定額だけでなく引き取り条件も確認しましょう。</p>`).join("");
  const { run, report } = await runValidation(`${shell()}${body}${close()}`);
  assert.notEqual(run.status, 0);
  assert.equal(check(report, "long_common_suffix_not_repeated").passed, false);
});

test("D: 補足1としてと補足ポイント1：の両方を検出する", async () => {
  const body = [
    "津市でバイク買取を相談する場合は、保管場所の道幅、駐輪場の位置、エンジン始動可否、鍵と書類の有無を先に伝えると、三重県内の出張査定日程を調整しやすくなります。補足1として、査定額だけでなく引き取り条件も確認しましょう。",
    "四日市市でバイク買取を相談する場合は、保管場所の道幅、駐輪場の位置、エンジン始動可否、鍵と書類の有無を先に伝えると、三重県内の出張査定日程を調整しやすくなります。補足ポイント1：査定額だけでなく引き取り条件も確認しましょう。",
    "伊勢市でバイク買取を相談する場合は、保管場所の道幅、駐輪場の位置、エンジン始動可否、鍵と書類の有無を先に伝えると、三重県内の出張査定日程を調整しやすくなります。補足２として、査定額だけでなく引き取り条件も確認しましょう。",
  ].map((text, index) => `<h3>地域${index + 1}</h3><p>${text}</p>`).join("");
  const { run, report } = await runValidation(`${shell()}${body}${close()}`);
  assert.notEqual(run.status, 0);
  assert.equal(check(report, "supplement_number_normalized_p_tags_not_duplicated").passed, false);
});

test("E: 車種ごとに内容が実質的に異なる場合はPASSする", async () => {
  const body = [
    ["PCX", "通勤距離、燃費、シート下収納、前後タイヤの摩耗を確認し、日常利用の傷と整備記録を分けて査定で説明しましょう。"],
    ["グロム", "カスタム内容、純正部品の有無、転倒傷、チェーンとスプロケットの状態を確認し、趣味性の高さを査定時に伝えましょう。"],
    ["モンキー125", "限定色、保管状態、純正外装、走行距離を確認し、コレクション需要がある個体かどうかを整理しましょう。"],
  ].map(([name, text]) => `<h3>${name}</h3><p>${text}</p>`).join("");
  const { run, report } = await runValidation(`${shell()}${body}${close()}`);
  assert.equal(run.status, 0, JSON.stringify(report.checks.filter((item) => !item.passed), null, 2));
});

test("F: 元記事より短くても主要情報を保持し重複がなければPASSする", async () => {
  const original = `${baseOriginal}<p>${"元記事の補足情報です。".repeat(80)}</p>`;
  const rewritten = `${shell()}<p>主要情報、固有名詞、検索意図を簡潔に保持します。</p>${close()}`;
  const { run, report } = await runValidation(rewritten, original);
  assert.equal(run.status, 0, JSON.stringify(report.checks.filter((item) => !item.passed), null, 2));
  assert.equal(check(report, "text_length_not_greatly_reduced").passed, true);
  assert.equal(check(report, "text_length_not_greatly_reduced").details.severity, "warning");
});

test("G: 正常な同一表現が2回だけ出た場合は過剰検知しない", async () => {
  const repeated = "査定前には書類と車両状態を確認しましょう。";
  const rewritten = `${shell()}<h3>準備</h3><p>${repeated}</p><h3>確認</h3><p>${repeated}</p>${close()}`;
  const { run, report } = await runValidation(rewritten);
  assert.equal(run.status, 0, JSON.stringify(report.checks.filter((item) => !item.passed), null, 2));
});

test("元記事より30％短くても主要情報を保持していればPASSする", async () => {
  const original = `${shell()}<p>バイク王、バイクランド、必要書類、出張査定、ローン残債、名義変更、自賠責保険、軽自動車税、査定前準備、契約前確認を説明します。</p><p>${"補足説明です。".repeat(30)}</p>${close()}`;
  const rewritten = `${shell()}<p>バイク王、バイクランド、必要書類、出張査定、ローン残債、名義変更、自賠責保険、軽自動車税、査定前準備、契約前確認を簡潔に整理します。</p>${close()}`;
  const { run, report } = await runValidation(rewritten, original);
  assert.equal(run.status, 0, JSON.stringify(report.checks.filter((item) => !item.passed), null, 2));
  assert.equal(check(report, "text_length_not_greatly_reduced").details.severity, "warning");
});

test("元記事と同じ文字数でも定型文を繰り返していればFAILする", async () => {
  const repeated = Array.from({ length: 3 }, (_, index) => {
    const shop = `店舗${index + 1}`;
    return `<h3>${shop}</h3><p>${shop}は、査定前に書類、車両状態、ローン残債、名義変更、自賠責保険、軽自動車税、引き取り条件を確認しましょう。契約前には入金時期とキャンセル条件を確認し、査定額だけで即決しないことが大切です。</p>`;
  }).join("");
  const rewritten = `${shell()}${repeated}${close()}`;
  const original = `${shell()}<p>${"元記事と同じ程度の文字量を持つ説明です。".repeat(40)}</p>${close()}`;
  const { run, report } = await runValidation(rewritten, original);
  assert.notEqual(run.status, 0);
  assert.equal(check(report, "topic_intro_normalized_p_tags_not_duplicated").passed, false);
});

test("18車種の共通注意点を一覧前に一度だけ記載した記事はPASSする", async () => {
  const common = "<p>各車種を選ぶときは、見た目だけでなく乗車姿勢、足つき、整備履歴、保険や税金を含めた維持費を一覧前にまとめて確認します。</p>";
  const body = Array.from({ length: 18 }, (_, index) => {
    const name = `車種${index + 1}`;
    return `<h3>${name}</h3><p>${name}は用途、価格帯、流通量の観点で個別に判断します。</p>`;
  }).join("");
  const { run, report } = await runValidation(`${shell()}${common}${body}${close()}`);
  assert.equal(run.status, 0, JSON.stringify(report.checks.filter((item) => !item.passed), null, 2));
});

test("店舗固有情報が少ない店舗を比較表へ統合した記事はPASSする", async () => {
  const table = `<table><thead><tr><th>店舗名</th><th>確認できる情報</th><th>査定前の確認</th></tr></thead><tbody>
<tr><td>店舗A</td><td>営業時間と持ち込み可否を確認</td><td>書類と引き取り条件</td></tr>
<tr><td>店舗B</td><td>出張対応エリアを確認</td><td>鍵と車両状態</td></tr>
<tr><td>店舗C</td><td>買取対象車種を確認</td><td>ローン残債</td></tr>
</tbody></table>`;
  const rewritten = `${shell()}<p>店舗ごとの固有情報が少ない場合は、同じ一般論を繰り返さず比較表に統合します。</p>${table}${close()}`;
  const { run, report } = await runValidation(rewritten);
  assert.equal(run.status, 0, JSON.stringify(report.checks.filter((item) => !item.passed), null, 2));
});
