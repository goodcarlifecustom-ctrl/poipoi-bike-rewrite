# AGENTS.md

## 目的

このリポジトリは、WordPress記事をCodex Cloudで自動リライトするためのものです。

ユーザーが記事URLを1つ渡した場合、確認待ちで停止せず、元記事HTMLの取得からWordPressへの新規下書き作成、作業ログ記録まで最後まで実行してください。

## 最重要ルール

- Codex Cloud前提で作業すること。Codex CLI前提の説明やローカル実行前提の手順にしない。
- ユーザーが記事URLを渡したら、確認待ちで停止しない。
- `rewrite-plan.md` の作成だけで止まらない。
- 既存の重要なH2/H3を勝手に削除しない。
- 元記事より情報量を減らさない。
- 元記事より本文文字数を少なくしない。
- 検索意図を変えない。
- リライト内容は `rules/rewrite-rule.md` と `articles/sample-article/input.md` を中心に制御する。
- 外部リンク方針は `rules/external-link-rule.md` を編集するだけで調整できるようにする。
- 比較表方針は `rules/comparison-table-rule.md` を編集するだけで調整できるようにする。
- 装飾方針は `rules/decoration-rule.md` を編集するだけで調整できるようにする。
- WordPressに貼り付け可能なHTMLで作成する。
- SWELLテーマで崩れにくいHTMLにする。
- WordPressの既存公開記事は直接更新しない。
- WordPressには必ず「新規下書き」として作成する。
- `.env` を作成・編集・コミットしない。
- 認証情報、WordPressユーザー名、アプリケーションパスワードをログ・作業メモ・標準出力に出力しない。

## URL一発ワークフロー

ユーザーの指示に記事URLが含まれる場合、以下の順番で必ず最後まで実行してください。

1. `rules/` 配下のルールファイルをすべて読む。比較表作成時は必ず `rules/comparison-table-rule.md` を読む。
2. `articles/sample-article/input.md` を読む。
3. ユーザー指示内の記事URLを取得する。
4. `node scripts/import-original-from-url.mjs "<記事URL>"` を実行して `articles/sample-article/original.html` を作成する。
5. `articles/sample-article/original.html` を分析する。
6. `articles/sample-article/rewrite-plan.md` を作成する。
7. 確認待ちで止まらず、続けて `articles/sample-article/rewritten.html` を作成する。
8. リライト後・外部リンク挿入前・装飾前に必ず `rules/comparison-table-rule.md` を読み、`node scripts/build-comparison-table.mjs articles/sample-article` を実行して、必要に応じて比較表を自動作成・挿入する。
9. 比較表作成後・装飾前に必ず `rules/external-link-rule.md` を読み直し、その内容に従って、公的機関・公式サイト・信頼できる情報源への外部リンクを必要な箇所にだけ自然に追加する。
10. `rules/decoration-rule.md` に従って、SWELLテーマ向けのHTML装飾を適用する。装飾工程内で外部リンクを調整する場合も、必ず `rules/external-link-rule.md` を再確認し、見出し内にリンクを設置しない。
11. `node scripts/validate-rewritten.mjs` を実行する。
12. WordPress認証情報が環境変数で利用できる場合は、`node scripts/create-wordpress-draft.mjs` を実行してWordPressへ新規下書きを作成する。認証情報がない場合は投稿実行のみスキップし、その理由を `change-log.md` に記録する。
13. `articles/sample-article/change-log.md` に変更内容、比較表の作成・未作成理由、外部リンク追加箇所、検証結果、WordPress下書きURLまたは投稿スキップ理由を記録する。

## WordPress投稿ルール

- 投稿は必ずWordPress REST APIで新規作成する。
- `status` は必ず `draft` または `WP_DRAFT_STATUS` で指定された下書き相当のステータスにする。
- 既存記事IDを指定した更新、公開済み記事の直接更新、公開ステータスでの投稿は禁止。
- 認証情報は環境変数から読む。`.env` はローカル検証用であり、作成・編集・コミットしない。
- 投稿結果は `articles/sample-article/wordpress-draft.json` に保存する。

## 品質ガード（比較表・見出し・日本語）

- 比較表は「この記事でわかること」のcapbox内に入れない。capboxが完全に閉じた直後、またはおすすめ・ランキング系H2の直前に置く。
- `rewritten.html` に既存比較表がある場合、新しい比較表を重複追加しない。
- 比較表候補はランキング・おすすめ・サービス紹介系H2配下のサービス名、アプリ名、商品名、店舗名、または公式リンクが近くにある紹介項目に限定する。
- 選び方、注意点、FAQ、まとめ、方法、手順、チェックリスト系のH3や、「〜を選ぶ」「〜を確認」「〜のポイント」などの抽象見出しは比較表に入れない。
- 「追加確認が必要」が半数以上になる比較表、公式サイト・詳細リンクがほとんどない比較表、読者の意思決定に役立たない比較表は作成しない。
- 本文のないH2/H3、数字だけ違う量産見出し、同じH3の繰り返し、文字数稼ぎの見出し追加は禁止する。
- 「サービスサービス」「必要ことです」「注意ことです」「重要ことです」「〜は、〜は、」などの不自然な日本語や、同一・類似段落の繰り返しは禁止する。
