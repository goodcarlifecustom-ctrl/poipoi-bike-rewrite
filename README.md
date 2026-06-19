# poipoi-bike-rewrite

`poipoi-bike-rewrite` は、バイク買取MAX / `https://poi-poi.co.jp/bike/` 配下の記事をCodex CloudでSEOリライトし、WordPressへ新規下書きとして作成するためのワークフローです。

記事URLを1つ渡すだけで、元記事HTMLの取得、リライト計画作成、本文HTML作成、比較表作成、外部リンク追加、SWELL装飾、HTML検証、WordPress新規下書き作成、作業ログ記録まで進めることを目的としています。

## 対象サイトと記事ジャンル

- 対象サイト: `https://poi-poi.co.jp/bike/`
- ジャンル: バイク買取・バイク査定・バイク売却に関するSEOメディア
- 主なCV: バイク買取MAXなど、バイク買取サービスへの問い合わせ・査定依頼
- 想定記事: バイク買取業者比較、高く売る方法、出張査定の流れ、必要書類、名義変更、廃車手続き、不動車・事故車・原付・カスタム車の買取、地域別・車種別の買取記事

## Codex Cloudでの使い方

Codex Cloudのタスク欄に、リライトしたい記事URLを貼り付けて実行してください。

```text
https://poi-poi.co.jp/bike/example/
```

URLが渡されると、Codex Cloudは確認待ちで止まらず、以下を最後まで実行します。

1. `rules/` 配下のルールをすべて確認
2. `articles/sample-article/input.md` を確認
3. 記事URLから `articles/sample-article/original.html` を取得
4. `articles/sample-article/rewrite-plan.md` を作成
5. `articles/sample-article/rewritten.html` を作成
6. 必要に応じて `node scripts/build-comparison-table.mjs articles/sample-article` で比較表を作成・挿入
7. 公的機関・公式サイト・信頼できる情報源への外部リンクを追加
8. `node scripts/finalize-article.mjs articles/sample-article` でSWELL装飾、H2アンカー付き「この記事でわかること」生成、HTML検証、内部アンカー補正を完了
9. WordPressへ新規下書きとして投稿
10. `articles/sample-article/change-log.md` に作業内容・検証結果・下書きURLまたは投稿スキップ理由を記録

## リライト内容を変えたい場合

主に以下を編集してください。

- `articles/sample-article/input.md`
- `rules/rewrite-rule.md`

メインKWは記事URLごとに指定します。指定がない場合は、URL・タイトル・元記事のH1/H2/H3から自然に推定し、「バイク 買取」「バイク 査定」「バイク 売る」「バイク買取 おすすめ」「バイク買取 相場」「出張買取」「一括査定」などを必要に応じて補完します。

## 外部リンク方針を変えたい場合

以下を編集してください。

- `rules/external-link-rule.md`

国土交通省、自動車検査登録総合ポータルサイト、e-Gov法令検索、消費者庁、国民生活センター、個人情報保護委員会、警察庁、自治体の軽自動車税・原付手続きページ、自賠責保険や交通安全に関する公的・準公的ページを優先します。

## 装飾方針を変えたい場合

以下を編集してください。

- `rules/decoration-rule.md`

「この記事でわかること」リスト、H2/H3アンカー、比較表、チェックリスト、注意点リスト、メリット・デメリット表、補足吹き出しなどの方針を制御します。

## WordPress認証情報の管理

WordPressの認証情報はGitHubに入れず、Codex Cloudの環境変数で管理してください。認証情報の実値はREADME、ログ、作業メモに書かないでください。

使用する主な環境変数は以下です。

- `WP_USERNAME`
- `WP_APPLICATION_PASSWORD`
- `WP_REST_ROOT`
- `WP_POST_TYPES`（省略時: `posts,pages`）
- `WP_POST_TYPE`（下書き作成時の投稿タイプ。省略時: `posts`）
- `WP_DRAFT_STATUS`（省略時: `draft`）
- `WP_CONTENT_MODE`（省略時: `rendered`）
- `MIN_HTML_LENGTH`（省略時: `500`）

`.env.example` を参考に設定してください。`.env` はローカル検証用です。`.env` と `node_modules/` はコミットしないでください。

## npm scripts

```bash
npm run import -- "<記事URL>"
npm run table -- articles/sample-article
npm run finalize -- articles/sample-article
npm run draft -- articles/sample-article
```

`npm run finalize` は投稿対象の `rewritten.html` を更新し、装飾・目次生成・検証・内部アンカー補正をまとめて実行します。`npm run draft` は投稿直前にも finalize を実行してからWordPressへ新規下書きを作成します。既存公開記事は更新しません。

### WordPress REST API環境変数

- `WP_POST_TYPES`: 元記事取得時に検索する投稿タイプ候補です。`posts,pages` のように複数指定できます。
- `WP_POST_TYPE`: 新規下書き作成時に使う投稿タイプです。`posts` のように単一で指定します。
- `WP_REST_ROOT`: WordPress REST APIのルート、またはWordPress設置先URLを指定します。`create-wordpress-draft.mjs` 側で `wp/v2/{投稿タイプ}` を付加するため、`wp/v2` や投稿タイプ名までは含めません。

正しい例:

```env
WP_REST_ROOT=https://poi-poi.co.jp/bike/
WP_REST_ROOT=https://poi-poi.co.jp/bike/wp-json/
WP_POST_TYPE=posts
```

誤った例:

```env
WP_REST_ROOT=https://poi-poi.co.jp/bike/wp-json/wp/v2/
WP_REST_ROOT=https://poi-poi.co.jp/bike/wp-json/wp/v2/posts
```

`npm run decorate` は `rewritten.decorated.html` を作るプレビュー用です。投稿対象の `rewritten.html` は更新しないため、投稿前の完成処理には `npm run finalize -- articles/sample-article` を使ってください。
