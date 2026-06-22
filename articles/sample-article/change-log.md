# change-log

## サンプル初期化

- 旧ジャンルのサンプルを削除し、バイク買取MAX / poi-poi.co.jp/bike 向けのサンプル内容へ置き換えました。
- 比較表サンプルは出張買取と店舗持ち込みの違いを示す簡易表に変更しました。
- 外部リンクサンプルとして、国土交通省、国民生活センター、個人情報保護委員会へのリンクを追加しました。
- WordPress下書き結果は実認証情報を含まないサンプルJSONに変更しました。

## 2026-06-19 アンカー再生成チェック

- 最新main取り込み: `origin` リモートが未設定のため `git fetch origin main && git merge origin/main` は実行できず、現在の `work` ブランチ（HEAD: 357d9a5）で作業した。
- 対象記事URL: https://poi-poi.co.jp/bike/
- `articles/sample-article/rewritten.html` は 106,338 bytes あり、ネオクラシックバイク買取記事の本番記事全文として保持。テスト用・短縮用HTMLへの置換は行っていない。
- `node scripts/finalize-article.mjs articles/sample-article` を実行し、統合完成処理に成功。
- 「この記事でわかること」は1回のみ存在し、各 `li` は `href="#..."` 付きのアンカーリンクになっている。
- H2件数: 27、`href="#` 件数: 27、`articleTocLinkCount`: 27。
- `anchor-link-report.json` の `finalJudgement`: `PASS`。
- `decoration-validation-report.json` の `errors`: `[]`。
- 追加確認: リンクなし `li` なし、リンク先ID欠落なし、idなしH2なし、目次の二重生成なし、比較表のcapbox内混入なし。
- WordPress下書き作成: 環境変数は存在したため `node scripts/create-wordpress-draft.mjs articles/sample-article` を実行したが、WordPress REST APIが `404` を返したため新規下書き作成は失敗。既存公開記事は更新していない。`wordpress-draft.json` に失敗結果を保存。
- 新規下書きURL: 未作成。
- 古い下書きの扱い: 今回は新規下書きが作成されていないため、古い下書きの上書き・削除・更新は行っていない。

## 2026-06-19 YSP記事アンカー再生成

- 最新main取り込み: `git checkout main` は `main` ブランチが存在せず失敗、`git pull --ff-only origin main` は `origin` リモート未設定のため失敗。現在の `work` ブランチで作業した。
- 事前確認: `prompt.md` / `AGENTS.md` / `README.md` に finalize 手順があり、`create-wordpress-draft.mjs` は投稿前に `finalize-article.mjs` を実行する状態、`fix-internal-anchor-texts.mjs` はアンカー0件・目次リンク不足をFAILにする状態であることを確認。
- 対象URL: https://poi-poi.co.jp/bike/hikaku/ysp.html
- original.html取得: `node scripts/import-original-from-url.mjs "https://poi-poi.co.jp/bike/hikaku/ysp.html"` で WordPress REST API から取得成功。タイトルは「【YSPの評判 口コミって悪い？】買取も徹底調査しました！」、取得文字数は 11,162。
- `rewritten.html` はネオクラシック記事で別記事だったため、再取得したYSP記事本文をベースに本番記事全文として再作成し、短縮サンプル・テスト用HTMLには置き換えていない。
- 外部リンク検証に合わせ、消費者庁リンクを導入文（最初のH2より前）へ移動し、後半の重複箇所は国民生活センターのみ残した。
- `npm run finalize -- articles/sample-article` を実行し、統合完成処理に成功。
- 「この記事でわかること」は1回のみ存在し、目次内の全10件の `li` が `href="#..."` 付きアンカーリンクになっている。
- H2件数: 10、`href="#` 件数: 10、`articleTocLinkCount`: 10。
- `anchor-link-report.json` の `finalJudgement`: `PASS`。
- `decoration-validation-report.json` の `errors`: `[]`。
- 追加確認: リンクなし目次 `li` なし、リンク先ID欠落なし、idなしH2なし、目次の二重生成なし、比較表のcapbox内混入なし、短縮サンプル・テスト用HTML文言なし。
- WordPress下書き作成: `npm run draft -- articles/sample-article` を実行したが、WordPress REST APIが `404` を返したため新規下書き作成は失敗。既存公開記事は更新していない。`wordpress-draft.json` に失敗結果を保存。
- 新規下書きID: 未作成。編集URL: 未作成。確認可能URL: 未作成。
- 旧下書きの扱い: 古い下書きID・URLは不明。今回の新規下書きは作成されていないため、旧下書きの上書き・削除・更新は行っていない。マージ前の旧下書きがある場合はアンカー未反映の可能性があるため使用しない。
- 複数記事確認: `articles/` 配下で確認可能な `rewritten.html` は `articles/sample-article/rewritten.html` のみ。目次内リンクなし `li` は残っていない。

## 2026-06-19 WordPress下書きRESTルート修正

- 投稿前確認: `rewritten.html` とコミット済みHTMLの SHA-256 は一致（69bb1e3dc10e9cc6cabca38b0eb369a999b7eda8d96a258d9eb3b5d62ee198e6）。H2件数は10、`href="#` 件数は10。
- `original.meta.json` の取得成功済みREST APIルートは `https://poi-poi.co.jp/bike/wp-json/`、投稿タイプは `posts`。
- Codex Cloud環境変数の `WP_REST_ROOT` は `/bike/wp-json/wp/v2` まで含んでおり、下書き作成スクリプトがさらに `wp/v2/posts` を付加していたことが `404 rest_no_route` の原因。
- `create-wordpress-draft.mjs` に投稿前プリフライトを追加し、RESTルート、`wp/v2` namespace、`wp/v2/types`、投稿タイプREST base、POST対象route、対象記事URLと投稿先RESTルートのoriginを確認してから投稿するようにした。
- `WP_REST_ROOT` に `/wp-json/wp/v2/` が含まれる場合は明確にFAILし、取得成功済みの `original.meta.json` のRESTルートへ合わせるようにした。
- プリフライト結果は `wp-rest-preflight.json` に保存。今回のプリフライトは `PASS`、REST root は `https://poi-poi.co.jp/bike/wp-json/`、POST endpoint は `https://poi-poi.co.jp/bike/wp-json/wp/v2/posts`。
- `input.md` に完全な記事タイトル「【YSPの評判 口コミって悪い？】買取も徹底調査しました！」を追加し、フォールバックタイトルや短すぎるタイトルでは投稿しない検証を追加。
- `npm run draft -- articles/sample-article` を再実行し、新規下書き作成に成功。下書きIDは 29300、編集URLは `https://poi-poi.co.jp/wp-admin/post.php?post=29300&action=edit`、確認可能URLは `https://poi-poi.co.jp/bike/?p=29300`。
- 投稿後確認としてWordPress REST APIから下書き本文を再取得し、ステータス `draft`、H2件数10、目次リンク数10、`href="#` 件数10、「この記事でわかること」1回、リンク先ID欠落なし、YSP記事本文、完全な投稿タイトルであることを確認。
- 既存公開記事・既存下書きは更新していない。

## 2026-06-19 HTML成果物整合性確認

- 記事本文の再リライト、新規WordPress下書き作成、既存公開記事・既存下書き更新は行っていない。
- 作業ディレクトリの `rewritten.html` と git HEAD の `rewritten.html` は SHA-256 が一致（69bb1e3dc10e9cc6cabca38b0eb369a999b7eda8d96a258d9eb3b5d62ee198e6）。
- WordPress下書きID 29300を認証付き `context=edit` で再取得し、`content.raw` と `content.rendered` を別々に検証した。
- 作業ディレクトリ、git HEAD、WordPress `content.raw` は同一SHA。WordPress `content.rendered` はWordPress側のレンダリング差分によりSHAが異なるが、構造件数は一致。
- 全成果物で H2件数10、idなしH2件数0、「この記事でわかること」1回、記事目次li件数10、記事目次内アンカー10、リンクなし目次li件数0、リンク先ID欠落0を確認。
- 確認用HTMLとして `finalized-confirmation.html` を出力した。これは finalize 後の正しいHTMLであり、作業ディレクトリおよびgit HEADの `rewritten.html` と同一SHA。
- 添付HTMLでリンクなしliに見えるものがある場合、それは finalize 前の旧ファイルまたは別表示のHTMLであり、今回確認した最新版ではない。
- WordPress下書きID 29300の本文は正常。
- WordPress下書きID 29300のタイトルに `{line_range_start=` / `line_range_end=` / `terminal_chunk_id=` / `【F:` の内部文字列混入はない。
- ただし、実際のWordPress下書きタイトルは「【YSPの評判 口コミって悪い？】買取も徹底調査しました！」で、期待値「【YSPの評判・口コミって悪い？】買取も徹底調査しました！」とは中黒の有無が異なる。既存下書きは更新していないため、タイトル修正が必要な場合は下書きID 29300のタイトルのみ更新判断が必要。今後の投稿用に `input.md` の記事タイトルは期待値へ修正した。

## 2026-06-19 WordPress下書きID 29300タイトル修正

- 更新前に下書きID 29300を認証付き `context=edit` で取得し、タイトル、ステータス、`content.raw` SHA-256、H2件数、記事目次リンク数、`href="#` 件数を確認した。
- 更新前タイトル: 「【YSPの評判 口コミって悪い？】買取も徹底調査しました！」。
- タイトルのみを「【YSPの評判・口コミって悪い？】買取も徹底調査しました！」へ更新した。本文 `content`、slug、カテゴリー、タグ、アイキャッチ、抜粋、ステータスは変更していない。
- 更新後に下書きID 29300を再取得し、タイトル完全一致、ステータス `draft`、`content.raw` SHA-256一致、H2件数10、記事目次リンク数10、`href="#` 件数10、「この記事でわかること」1回、リンク先ID欠落0、本文変更なしを確認した。
- 更新前 `content.raw` SHA-256: 69bb1e3dc10e9cc6cabca38b0eb369a999b7eda8d96a258d9eb3b5d62ee198e6。
- 更新後 `content.raw` SHA-256: 69bb1e3dc10e9cc6cabca38b0eb369a999b7eda8d96a258d9eb3b5d62ee198e6。
- 新規下書きは作成していない。既存公開記事は更新していない。下書きID 29300以外は変更していない。

## 2026-06-22 本文内タイトル二重表示の再発防止対応

- 対象記事一式で本文HTMLのH1混入を検証し、`articles/sample-article/rewritten.html` の `<h1>` が0件であることを確認した。`article.html` / `article-linked.html` / `article-decorated.html` は対象ディレクトリに存在しないため、存在する本文HTMLのみ検証対象とした。
- 本文先頭は導入文から始まっており、投稿タイトル相当のH1/H2は存在しなかったため、削除した本文内タイトルはなし。
- `scripts/validate-rewritten.mjs` に、`article.html` / `article-linked.html` / `article-decorated.html` / `rewritten.html` に `<h1>` が含まれる場合のFAIL、および本文冒頭の最初の見出しが投稿タイトルと同一またはほぼ同じ場合のFAILを追加した。
- `scripts/create-wordpress-draft.mjs` から本文内H1を投稿タイトル候補にするフォールバックを削除し、WordPress送信予定の `content.raw` に `<h1>` が含まれる場合、および本文冒頭の最初の見出しが投稿タイトルと同一またはほぼ同じ場合は投稿を停止する検証を追加した。
- `scripts/create-wordpress-draft.mjs` は同一記事の既存下書き（draft / pending / private）のみ更新対象にし、公開済み記事は更新しない。既存の `wordpress-draft.json` / `wordpress-draft-verification.json` の下書きIDも確認し、既存下書き更新を優先するようにした。
- `npm run draft -- articles/sample-article` を実行し、既存下書きID 29516を更新した。ステータスは `draft`、下書きURLは `https://poi-poi.co.jp/bike/?p=29516`。
- 投稿後にWordPress REST APIの `context=edit` で下書きID 29516を検証し、`content.raw` の `<h1>` は0件、`content.rendered` の `<h1>` も0件、ステータスは `draft` であることを `wordpress-draft-verification.json` に保存した。

## 2026-06-22 プレビュー画面レンダリング確認の試行

- `scripts/verify-wordpress-preview.mjs` を追加し、下書きプレビューURLをHTTP取得して、実際に返ったHTML内のH1/H2/H3、タイトル類似要素、禁止タイトル文言の有無をDOMベースで記録できるようにした。
- `node scripts/verify-wordpress-preview.mjs articles/sample-article` を実行したが、下書きID 29516の未ログインプレビューURL `https://poi-poi.co.jp/bike/?p=29516` はHTTP 404を返し、実記事プレビューではなく404ページが返った。結果は `wordpress-preview-render-verification.json` に保存した。
- 返却されたDOM上部の見出しは404ページの `<h1 class="c-ttl404">ページが見つかりませんでした。</h1>` のみで、下書き本文の実レンダリング確認は未完了。WordPressログイン済みブラウザセッション、または有効なpreview_nonce付きURLがない状態では、実際の下書きプレビュー画面でタイトルが1つだけかを完了判定できない。
- 禁止文言「単気筒バイクおすすめ車種まとめ｜メリット・デメリットと乗り方、中古購入・買取査定のポイント」は、取得できたHTML内には存在しなかった。

## 2026-06-22 プレビュー検証ステータス整理

- 未ログイン状態の通常投稿URL `https://poi-poi.co.jp/bike/?p=29516` を実プレビューとして扱わないように、`scripts/verify-wordpress-preview.mjs` を修正した。`WP_PREVIEW_URL` が未指定、または `preview=true` を含まない場合は画面取得を開始せず、`INCONCLUSIVE_AUTH_REQUIRED` として記録する。
- HTTP 401 / 403 / 404、または404/エラーテンプレートを検出した場合も記事本文のDOM検証には使わず、`visualRenderValidation: pending_manual` として扱う。404ページ内のH1/H2/H3は本文見出し結果に含めない。
- `wordpress-preview-render-verification.json` は `codeValidation: passed`、`restApiValidation: passed`、`visualRenderValidation: pending_manual`、`reason: authenticated WordPress preview session unavailable` に整理した。
- 現在の完了状態は「コードとREST APIの検証は完了、ログイン済みブラウザでの目視確認のみ未完了」。認証情報、Cookie、nonceはリポジトリ・ログ・JSONへ保存していない。

## 2026-06-22 ユーザー手動目視確認の反映

- ユーザーがWordPressへログインしたブラウザで下書きID 29516の実プレビューを手動確認済み。表示タイトル数は1、テーマ側の投稿タイトルのみ表示、本文内の重複タイトルなし、投稿タイトル直後は導入文、ステータスは `draft`。
- `wordpress-preview-render-verification.json` を `VISUAL_RENDER_PASSED_MANUAL` / `visualRenderValidation: passed_manual` に更新した。
- 追加のWordPress更新・下書き再送信は実施していない。認証情報、プレビューURLのnonce、Cookieはリポジトリ・ログ・JSONへ保存していない。
