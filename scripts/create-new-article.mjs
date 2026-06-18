#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_KEYWORD = "150cc バイク おすすめ";
const ARTICLE_DIR = path.join("articles", "150cc-bike-osusume");
const GSC_ROWS = path.join("gsc-data", "150cc-bike-osusume", "search-console-rows.json");
const targetKeyword = process.env.TARGET_KEYWORD?.trim() || SUPPORTED_KEYWORD;
const now = new Date().toISOString();

if (targetKeyword !== SUPPORTED_KEYWORD) {
  throw new Error(`この新規記事ワークフローは「${SUPPORTED_KEYWORD}」専用です。入力キーワード「${targetKeyword}」ではWordPress投稿前に停止します。`);
}

const officialSources = [
  ["国土交通省 自動車検査登録総合ポータル", "https://www.mlit.go.jp/jidosha/kensatoroku/", "高速道路・道路運送車両制度などの確認先"],
  ["警察庁 運転免許", "https://www.npa.go.jp/policies/application/license_renewal/index.html", "免許制度の確認先"],
  ["Honda 二輪製品情報", "https://www.honda.co.jp/motor/", "車種・諸元・価格の確認先"],
  ["Yamaha Motor バイク・スクーター", "https://www.yamaha-motor.co.jp/mc/", "車種・諸元・価格の確認先"],
  ["Suzuki 二輪車", "https://www1.suzuki.co.jp/motor/", "車種・諸元・価格の確認先"],
  ["Kawasaki モーターサイクル", "https://www.kawasaki-motors.com/ja-jp/", "車種・諸元・価格の確認先"],
];

function stripTags(html) { return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
function esc(v) { return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function pct(v) { return `${((Number(v) || 0) * 100).toFixed(2)}%`; }
function fmtPos(v) { return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "0.0"; }
function uniqBy(rows, keyFn) { const seen = new Set(); return rows.filter((r) => { const k = keyFn(r); if (seen.has(k)) return false; seen.add(k); return true; }); }
function mdRow(cells) { return `| ${cells.map((c) => String(c ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim()).join(" | ")} |`; }
async function readGscRows() {
  const raw = await readFile(GSC_ROWS, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { rows: parsed, views: {}, ok: true };
  return { rows: parsed.rows || [], views: parsed.views || {}, startDate: parsed.startDate, endDate: parsed.endDate, targetKeyword: parsed.targetKeyword, ok: true };
}
function topRows(gsc, viewName, fallbackSort, limit = 6) {
  const viewRows = Array.isArray(gsc.views?.[viewName]) ? gsc.views[viewName] : [];
  const base = viewRows.length ? viewRows : [...(gsc.rows || [])].sort(fallbackSort);
  return uniqBy(base, (r) => `${r.query}\u0000${r.page}`).slice(0, limit);
}
function queryText(rows) { return rows.map((r) => r.query).filter(Boolean); }
function conditionLabel(row) { return (row.matchedConditions || []).join("/") || "-"; }
function rowsToHtmlList(rows, emptyText) {
  if (!rows.length) return `<p>${esc(emptyText)}</p>`;
  return `<ul>${rows.map((r) => `<li><strong>${esc(r.query)}</strong>（表示回数${r.impressions ?? 0}、クリック${r.clicks ?? 0}、CTR ${pct(r.ctr)}、平均掲載順位${fmtPos(r.position)}、条件${esc(conditionLabel(r))}）</li>`).join("")}</ul>`;
}
function reflectionRows(rows, place, reason) {
  return rows.map((r) => ({ query: r.query, clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: r.ctr ?? 0, position: r.position ?? 0, matchedConditions: r.matchedConditions || [], reflectedIn: place, reason }));
}

const gsc = await readGscRows();
const topImpressions = topRows(gsc, "topImpressions", (a, b) => (b.impressions || 0) - (a.impressions || 0));
const topClicks = topRows(gsc, "topClicks", (a, b) => (b.clicks || 0) - (a.clicks || 0));
const position8to20 = topRows(gsc, "position8to20", (a, b) => (b.impressions || 0) - (a.impressions || 0));
const ctrImprove = topRows(gsc, "ctrImprove", (a, b) => (a.ctr || 0) - (b.ctr || 0) || (b.impressions || 0) - (a.impressions || 0));
const relatedPages = Array.isArray(gsc.views?.relatedPages) ? gsc.views.relatedPages.slice(0, 8) : [];
const gscHasRows = (gsc.rows || []).length > 0;

const reflected = uniqBy([...topImpressions.slice(0, 3), ...topClicks.slice(0, 3), ...position8to20.slice(0, 3), ...ctrImprove.slice(0, 3)], (r) => `${r.query}\u0000${r.page}`);
const reflectedQueries = queryText(reflected);
const titleModifier = topClicks[0]?.query && topClicks[0].query !== targetKeyword ? `｜${topClicks[0].query}も解説` : "";
const title = `150ccバイクおすすめ比較｜125ccとの違い・高速道路・維持費${titleModifier}`.slice(0, 68);
const slug = "150cc-bike-osusume";
const excerpt = `150ccバイクおすすめを探す人向けに、Search Consoleで確認した関連クエリ${reflectedQueries.length ? `（${reflectedQueries.slice(0, 3).join("、")}）` : ""}を踏まえ、125ccとの違い、高速道路、維持費、用途別の選び方を整理します。`;
const metaDescription = excerpt.slice(0, 155);

const tableRows = [
  ["街乗り・通勤向け", topImpressions[0]?.query || "150cc バイク おすすめ", "収納・燃費・取り回し", "表示回数上位の比較ニーズを導入と選び方に反映"],
  ["ツーリング向け", position8to20[0]?.query || "150cc バイク 高速", "高速道路・航続距離・安定性", "8〜20位クエリを追記候補としてFAQへ反映"],
  ["CTR改善向け", ctrImprove[0]?.query || "150cc 125cc 違い", "タイトルと説明文で疑問を明確化", "表示回数に対してCTRが低い検索意図を補足"],
].map((r)=>`<tr>${r.map((c)=>`<td>${esc(c)}</td>`).join("")}</tr>`).join("\n");

const relatedLinks = relatedPages.length
  ? `<ul>${relatedPages.map((p) => `<li><a href="${esc(p.page)}">${esc(p.page)}</a>：関連クエリ ${esc((p.queries || []).slice(0, 4).join("、"))}。新規記事では150cc選び、既存ページでは既存の検索意図を尊重して内部リンクで棲み分けます。</li>`).join("")}</ul>`
  : "<p>Search Console上で明確に関連する既存ページは確認できませんでした。公開前にサイト内検索で重複テーマを再確認します。</p>";

const article = `<p>150ccクラスのバイクは、125ccより走行シーンが広がり、高速道路を使う移動も検討しやすい一方で、免許区分や維持費、駐輪環境の確認が欠かせません。この記事では「${esc(targetKeyword)}」で探している人向けに、Search Consoleで取得した自サイトの表示実績を踏まえて、150cc・155cc前後のバイクを選ぶ評価軸を整理します。</p>
<div class="swell-block-capbox cap_box is-style-onborder"><div class="cap_box_ttl"><span>この記事でわかること</span></div><div class="cap_box_content"><ul><li>150ccクラスと125ccの違い</li><li>街乗り・通勤・ツーリング別の選び方</li><li>免許、高速道路、維持費で確認すべき点</li><li>Search Consoleで見えた関連ニーズと内部リンク方針</li></ul></div></div>
<h2>Search Consoleで確認した150ccバイクの検索ニーズ</h2>
<p>${gscHasRows ? "自サイトがGoogle検索に表示された実績から、次のクエリ群を記事構成へ反映します。" : "Search Console API取得は成功しましたが、この条件の検索実績は0件でした。存在しないデータは推測せず、基本キーワードと公式情報の確認方針に基づいて下書きを作成します。"}</p>
<h3>表示回数上位クエリ</h3>${rowsToHtmlList(topImpressions, "表示回数上位クエリは0件です。")}
<h3>クリック数上位クエリ</h3>${rowsToHtmlList(topClicks, "クリック数上位クエリは0件です。")}
<h3>8〜20位の追記候補</h3>${rowsToHtmlList(position8to20, "8〜20位の追記候補は0件です。")}
<h3>CTR改善候補</h3>${rowsToHtmlList(ctrImprove, "CTR改善候補は0件です。")}
<h2>150ccクラスの特徴</h2>
<p>150ccクラスは、一般に149cc、150cc、155ccなどの軽二輪に含まれる排気量帯として検討されます。125ccクラスより余裕のある走りを期待しやすく、高速道路や自動車専用道路を使う可能性がある人に向きます。ただし、実際の排気量、価格、車重、燃費、装備、販売状況はモデルごとに変わるため、購入前にメーカー公式ページで最新情報を確認してください。</p>
<h2>125ccとの違い</h2>
<p>125cc以下の原付二種とは、利用できる道路、必要な免許、税金や保険、車検の有無、任意保険の扱いが変わります。150cc前後は高速道路を利用できる排気量帯として検討されますが、二輪免許の条件や道路ごとの通行条件は公的情報で確認しましょう。</p>
<h2>150cc・155ccクラスが向いている人</h2>
<ul><li>通勤で幹線道路やバイパスを走る機会がある人</li><li>休日に少し遠い場所までツーリングしたい人</li><li>125ccでは走行余裕に不安がある人</li><li>大型バイクほどの重量や維持費は避けたい人</li></ul>
<h2>おすすめ車種の比較表</h2>
<table><thead><tr><th>用途</th><th>反映した検索ニーズ</th><th>重視ポイント</th><th>記事での扱い</th></tr></thead><tbody>${tableRows}</tbody></table>
<p>上表は根拠のない順位付けではなく、用途別に確認すべき評価軸をまとめたものです。具体的な車種名、正確な排気量、メーカー希望小売価格、販売状況、車両重量、燃費、生産終了情報は自動生成時点では推測せず、公開前にメーカー公式ページで確認して追記してください。</p>
<h2>用途別おすすめ</h2>
<h3>街乗り</h3><p>街乗りでは、低速域の扱いやすさ、足つき、収納、駐輪場に収まる車体サイズを重視します。表示回数上位のクエリは、導入文と比較表で「どの用途で選ぶか」を明確にするために使います。</p>
<h3>通勤</h3><p>通勤では、燃費、航続距離、雨天時の装備、メンテナンス性、毎日使っても疲れにくい乗車姿勢を確認します。クリックがある関連クエリは、読者がすでに関心を持っている疑問として本文に自然に反映します。</p>
<h3>ツーリング</h3><p>ツーリングでは、巡航時の余裕、燃料タンク容量、荷物の積みやすさ、スクリーンやキャリアなど純正アクセサリーの有無が判断材料になります。</p>
<h3>燃費重視</h3><p>燃費はカタログ値だけでなく、走行環境や積載、速度域で変わります。公式諸元の燃費測定条件も合わせて確認しましょう。</p>
<h3>取り回し重視</h3><p>取り回しを重視するなら、装備重量、シート高、ハンドル切れ角、センタースタンドの有無を確認します。</p>
<h2>選び方</h2>
<p>150ccバイクは、価格だけでなく、用途、駐輪環境、走行距離、メンテナンス体制、売却時のリセールまで含めて選ぶと失敗しにくくなります。${reflectedQueries.length ? `この記事では「${esc(reflectedQueries.slice(0, 5).join("」「"))}」などの検索実績を、見出しやFAQの補足に分散して反映します。` : "Search Console実績が0件の場合は、検索データを推測せず、読者の基本的な比較観点を中心に構成します。"}</p>
<h2>免許・高速道路・維持費の注意点</h2>
<p>150cc前後のバイクに乗るには、排気量に対応した二輪免許が必要です。高速道路の通行可否、軽自動車税、自賠責保険、任意保険、点検費用なども125cc以下とは異なるため、購入前に公的機関や保険会社の一次情報で確認してください。</p>
<h2>購入前に確認すべきポイント</h2>
<ul><li>現行販売モデルか、生産終了モデルか</li><li>正確な排気量とメーカー希望小売価格の税込・諸費用条件</li><li>装備重量、シート高、燃費、燃料タンク容量</li><li>正規販売店、保証、部品供給、リコール情報</li><li>将来売る場合の査定需要と保管状態</li></ul>
<h2>関連する既存ページと内部リンク方針</h2>
${relatedLinks}
<h2>よくある疑問</h2>
<h3>150ccバイクは高速道路に乗れますか？</h3><p>一般に125cc超の軽二輪は高速道路利用を検討できます。ただし、免許条件や道路ごとの規制があるため、実際の通行前に最新の公的情報を確認してください。</p>
<h3>150ccと155ccは同じように比較できますか？</h3><p>近い排気量帯として比較されますが、モデルごとに正確な排気量、出力、車重、価格が異なります。記事ではまとめて扱う場合でも、公開前に各車種の正確な排気量を明記する必要があります。</p>
<h3>Search Consoleの表示回数は検索ボリュームですか？</h3><p>いいえ。Search Consoleの値は、自サイトがGoogle検索に表示された実績であり、市場全体の検索ボリュームではありません。記事の優先順位づけの参考として扱います。</p>
<h3>売却まで考えるなら何を重視すべきですか？</h3><p>定期点検記録、純正部品の保管、転倒歴の有無、カスタム内容、保管状態は査定で見られやすいポイントです。購入時から売却時の説明がしやすい状態を保つと、査定相談がスムーズです。</p>
<h2>まとめ</h2>
<p>150ccバイクは、125ccより行動範囲を広げたい人に向く選択肢です。用途別の評価軸を決め、メーカー公式情報と公的情報で最新条件を確認してから候補を絞りましょう。将来の乗り換えや売却を考えている場合は、購入前から査定で確認されるポイントも意識しておくと安心です。</p>
<div class="swell-block-button red_"><a href="/bike/" class="swell-block-button__link"><span>バイクの購入・売却前に買取相場や査定ポイントも確認する</span></a></div>
`;
if (/<h1\b/i.test(article)) throw new Error("article.html に h1 が含まれています。WordPress投稿タイトルとの重複を避けるため停止します。");

const metadata = { targetKeyword, title, slug, excerpt, metaDescription, status: "draft", categories: [], generatedAt: now };
const sources = `# sources\n\n確認日: ${now.slice(0,10)}\n\nこの記事の自動生成スクリプトは外部サイトをクロールして最新車種情報を自動取得していません。記事内では具体的な車種名、正確な排気量、メーカー希望小売価格、販売状況、車両重量、燃費、生産終了情報を推測せず、公開前に以下の一次情報で更新する方針を明記しています。\n\n${officialSources.map(([name,url,note])=>`- ${name}: ${url}（${note}）`).join("\n")}\n\n## Search Console\n\n- 参照ファイル: ${GSC_ROWS}\n- 対象期間: ${gsc.startDate || "0件または未記録"}〜${gsc.endDate || "0件または未記録"}\n- 取得行数: ${(gsc.rows || []).length}\n`;
const reflectedDetails = [
  ...reflectionRows(topImpressions.slice(0, 3), "SEOタイトル、導入文、比較表", "表示回数が多く、主要検索意図として優先するため"),
  ...reflectionRows(topClicks.slice(0, 3), "メタディスクリプション、用途別おすすめ", "クリック実績があり、読者関心が確認できるため"),
  ...reflectionRows(position8to20.slice(0, 3), "FAQ、免許・高速道路の注意点", "平均掲載順位8〜20位で追記により改善余地があるため"),
  ...reflectionRows(ctrImprove.slice(0, 3), "FAQ、選び方、比較表", "表示回数に対してCTRが低く、説明補強が必要なため"),
];
const reflectedKeys = new Set(reflectedDetails.map((r) => `${r.query}\u0000${r.reflectedIn}`));
const unreflected = uniqBy([...(gsc.rows || [])].sort((a,b)=>(b.impressions||0)-(a.impressions||0)), (r)=>`${r.query}\u0000${r.page}`).filter((r)=>![...reflectedKeys].some((k)=>k.startsWith(`${r.query}\u0000`))).slice(0, 10);
const check = `# 記事作成チェックレポート\n\n## Search Console連携\n\n- 取得結果: ${gscHasRows ? "成功（検索実績あり）" : "成功（0件）"}\n- 取得期間: ${gsc.startDate || "0件または未記録"}〜${gsc.endDate || "0件または未記録"}\n- 取得方法: searchconsole.searchanalytics.query / query,page dimensions\n- APIリクエスト条件: A=150cc+バイク+おすすめ、B=150cc+バイク、C=150cc\n- 取得クエリ数: ${new Set((gsc.rows || []).map((r)=>r.query)).size}\n- 取得ページ数: ${new Set((gsc.rows || []).map((r)=>r.page)).size}\n- 表示回数上位: ${queryText(topImpressions).join("、") || "0件"}\n- クリック数上位: ${queryText(topClicks).join("、") || "0件"}\n- CTR改善候補: ${queryText(ctrImprove).join("、") || "0件"}\n- 8〜20位の追記候補: ${queryText(position8to20).join("、") || "0件"}\n\n## 記事に反映したクエリ\n\n${reflectedDetails.length ? `${mdRow(["query","clicks","impressions","ctr","position","matchedConditions","記事内の反映箇所","反映した理由"])}\n${mdRow(["---","---:","---:","---:","---:","---","---","---"])}\n${reflectedDetails.map((r)=>mdRow([r.query,r.clicks,r.impressions,pct(r.ctr),fmtPos(r.position),(r.matchedConditions||[]).join("/"),r.reflectedIn,r.reason])).join("\n")}` : "Search Console取得結果が0件のため、実績クエリの反映はありません。"}\n\n## 反映しなかった主要クエリ\n\n${unreflected.length ? `${mdRow(["query","clicks","impressions","ctr","position","matchedConditions","反映しなかった理由"])}\n${mdRow(["---","---:","---:","---:","---:","---","---"])}\n${unreflected.map((r)=>mdRow([r.query,r.clicks ?? 0,r.impressions ?? 0,pct(r.ctr),fmtPos(r.position),conditionLabel(r),"上位反映枠との重複、または既存ページの検索意図を尊重するため本文へ無理に追加しません。"])).join("\n")}` : "反映しなかった主要クエリはありません。"}\n\n## カニバリゼーション確認\n\n${relatedPages.length ? relatedPages.map((p)=>`- 既存記事URL: ${p.page}\n  - 対応する検索クエリ: ${(p.queries || []).join("、")}\n  - clicks: ${p.clicks || 0}\n  - impressions: ${p.impressions || 0}\n  - 新規記事との検索意図の違い: 新規記事は150ccクラス選び、既存ページは取得済みクエリの既存意図を維持\n  - カニバリゼーションの可能性: 要確認\n  - 内部リンク方針: 新規記事から関連ページへ補足リンクし、既存ページを自動更新しない`).join("\n") : "Search Console取得結果内に関連する既存ページはありません。"}\n\n## 情報源確認\n\n- 記事生成スクリプトは外部情報を自動取得していません。\n- 車種名、正確な排気量、メーカー希望小売価格、販売状況、車両重量、燃費、生産終了情報は推測していません。\n- 公開前に sources.md のメーカー公式ページ・公的機関で確認して更新してください。\n\n## WordPress下書き確認\n\nWordPress投稿スクリプトでstatus=draftを固定し、作成・更新後にREST APIで再取得してdraftであることを確認します。article.html はH2/本文から開始し、H1はmetadata.jsonのtitleをWordPress投稿タイトルとして使用します。\n`;

await mkdir(ARTICLE_DIR, { recursive: true });
await writeFile(path.join(ARTICLE_DIR, "article.html"), article);
await writeFile(path.join(ARTICLE_DIR, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
await writeFile(path.join(ARTICLE_DIR, "sources.md"), sources);
await writeFile(path.join(ARTICLE_DIR, "check-report.md"), check);
console.log(`記事ファイルを作成しました: ${ARTICLE_DIR}`);
console.log(`文字数: ${stripTags(article).length}`);
