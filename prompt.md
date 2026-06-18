# Codex Cloud用：バイク買取SEO記事URL一発リライト・WordPress下書き作成指示書

以下の記事URLで、URL一発ワークフローを実行してください。

記事URL：
https://poi-poi.co.jp/bike/〇〇

狙うキーワード：
記事URL・タイトル・元記事の内容から推定。不明な場合は、バイク買取の検索意図に沿って補完。

関連キーワード：
記事URL・タイトル・元記事の内容から推定。不明な場合は、バイク 買取、バイク 査定、バイク 売る、バイク買取 おすすめ、バイク買取 相場、出張買取、一括査定、高く売る、必要書類、廃車手続き、名義変更、原付 買取、不動車 買取、事故車 買取、カスタム車 買取などを補完。

## リライト方針

* AGENTS.md と prompt.md のURL一発ワークフローに従う。
* 記事URLから元記事HTMLを取得する。
* 既存 original.html のフォールバックは使わない。
* URL取得またはWordPress REST API取得の成功を確認する。
* 元記事の重要なH2/H3は勝手に削除しない。
* 元記事より本文文字数・情報量を減らさない。
* バイク買取の検索意図に合わせて、買取業者のおすすめ、費用感、メリット、デメリット、注意点、査定前の準備を整理する。
* アフィリエイト記事として、読者が自然におすすめサービス・査定依頼へ進めるCV導線を意識する。
* 必要に応じて比較表、メリット・デメリット表、注意点リスト、FAQを追加する。
* 外部リンクは rules/external-link-rule.md の最新ルールに従って追加する。
* 入力データに外部リンクがある場合は、記事主題に最も関連性が高い1件を選び、タイトルまたはH1直後〜最初のH2前に置く2〜4文程度の導入文内へ、具体的なアンカーテキスト付きで自然に配置する（URL単体・「こちら」リンク・不必要な重複は禁止）。
* 公的機関、法令、消費者保護、個人情報保護、安全対策に関する信頼できる外部リンクを自然な箇所に追加する。
* 外部リンクは見出し内には設置しない。
* 外部リンクには target="_blank" と rel="noopener noreferrer" を必ず付ける。
* rules/decoration-rule.md に従って、SWELL向けの装飾を適用する。
* WordPressには既存公開記事を更新せず、新規下書きとして作成する。
* 認証情報の値そのものは絶対に出力しない。
* .env と node_modules/ は絶対にコミットしない。

## 必ず実行するコマンド

1. `node scripts/import-original-from-url.mjs "<記事URL>"`
2. `node scripts/validate-rewritten.mjs`
3. `node scripts/create-wordpress-draft.mjs`

## 成功条件

* URL取得：成功
* rewritten.html作成：成功
* HTML検証：成功
* WordPress新規下書き作成：成功
* WordPress下書き本文：あり
* wordpress-draft.json に下書きID、編集URL、確認可能URL、投稿前本文文字数、投稿後本文文字数が保存されている
* change-log.md にURL取得結果、リライト内容、外部リンク追加箇所、検証結果、WordPress下書き作成結果が記録されている
* 既存公開記事は更新していない

## 最後のSummaryで明記すること

* URL取得：成功 / 失敗
* rewritten.html作成：成功 / 失敗
* rewritten.html文字数
* HTML検証：成功 / 失敗
* WordPress下書き作成：成功 / 失敗
* WordPress下書き本文：あり / なし
* 下書きID
* 編集URL
* 確認可能URL
* 外部リンクルール適用：成功 / 失敗
