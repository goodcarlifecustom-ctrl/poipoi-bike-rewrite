# SEOリライト用Codex Cloudワークフロー

このリポジトリは、記事URLを1つ渡すだけで、Codex Cloudが元記事HTMLの取得、SEOリライト、外部リンク追加、SWELL装飾、HTML検証、WordPress新規下書き作成、作業ログ記録まで進めるためのテンプレートです。

## Codex Cloudでの使い方

Codex Cloudのタスク欄に、リライトしたい記事URLを貼り付けて実行してください。

例：

```text
https://example.com/sample-article/
```

URLが渡されると、Codex Cloudは確認待ちで止まらず、以下を最後まで実行します。

1. `rules/` 配下のルールをすべて確認
2. `articles/sample-article/input.md` を確認
3. 記事URLから `articles/sample-article/original.html` を取得
4. `articles/sample-article/rewrite-plan.md` を作成
5. `articles/sample-article/rewritten.html` を作成
6. 公的機関・公式サイト・信頼できる情報源への外部リンクを追加
7. SWELLテーマ向けのHTML装飾を適用
8. `node scripts/validate-rewritten.mjs` でHTML検証
9. WordPressへ新規下書きとして投稿
10. `articles/sample-article/change-log.md` に作業内容・検証結果・下書きURLを記録

## リライト内容を変えたい場合

リライトの方向性、狙うキーワード、読者像、必ず入れたい要素を変えたい場合は、主に以下を編集してください。

- `articles/sample-article/input.md`
- `rules/rewrite-rule.md`

`input.md` には、対象URL、狙うKW、関連KW、現在の課題、リライトの目的、必ず守ること、必ず入れたい要素などを書きます。

## 外部リンク方針を変えたい場合

公的機関、自治体、法律、ガイドライン、公式サイト、信頼できる団体へのリンク方針を変えたい場合は、以下を編集してください。

- `rules/external-link-rule.md`

このファイルを編集するだけで、外部リンクを入れる場所、優先する情報源、避けるリンク、アンカーテキスト方針を調整できます。

## 装飾方針を変えたい場合

SWELLテーマ向けの装飾方針を変えたい場合は、以下を編集してください。

- `rules/decoration-rule.md`

「この記事でわかること」リスト、H2/H3アンカー、キャプションボックス、マーカー、段落調整などの方針をこのファイルで制御します。

## WordPress認証情報の管理

WordPressの認証情報はGitHubに入れず、Codex Cloudの環境変数で管理してください。

使用する環境変数は以下です。

- `WP_USERNAME`
- `WP_APPLICATION_PASSWORD`
- `WP_REST_ROOT`
- `WP_POST_TYPE`（省略時: `posts`）
- `WP_DRAFT_STATUS`（省略時: `draft`）

`.env` はローカル検証用です。GitHubにコミットしないでください。認証情報、ユーザー名、アプリケーションパスワードをログや作業メモに出力しないでください。

## npm scripts

Codex Cloudのワークフロー内で使う補助コマンドです。

```bash
npm run import -- "<記事URL>"
npm run validate
npm run draft
```

`npm run draft` はWordPressへ新規下書きを作成します。既存公開記事は更新しません。
