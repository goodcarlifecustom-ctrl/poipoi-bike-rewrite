# 比較表作成ルール

## 目的

バイク買取SEO記事で紹介している買取業者、査定サービス、売却方法、地域別店舗、車種別査定ポイントなどを、読者が比較しやすいHTMLテーブルで整理します。

## 情報取得元

1. `articles/<記事フォルダ>/rewritten.html`
2. `articles/<記事フォルダ>/original.html`
3. 記事内に設置済みの公式サイトリンク・アフィリエイトリンク周辺の本文
4. 必要な場合のみ公式サイトへアクセスして補足確認

公式サイトで確認できない情報は推測せず「追加確認が必要」と記載してください。

## 抽出対象

比較表の対象候補は以下です。

- バイク買取業者
- バイク一括査定サービス
- 出張買取サービス
- 地域別の買取店
- 車種別の査定ポイント
- エンジン・排気量・カテゴリ別の特徴
- 査定前チェック項目
- 売却方法の比較

## 比較表に入れてよい項目例

- サービス名
- 対応エリア
- 出張査定の有無
- 手数料・費用感
- 対応車種
- 不動車対応
- カスタム車対応
- おすすめな人
- 注意点
- 公式サイト・詳細

## 比較表に入れてはいけないもの

- 選び方
- 注意点
- FAQ
- まとめ
- チェックリスト
- 抽象的なH3
- サービス名・車種名・地域名ではない見出し
- 「〜を選ぶ」「〜を確認」「〜のポイント」などの抽象見出し

## 品質ルール

- 「追加確認が必要」が半数以上になる低品質な比較表は作成しない。
- 既存比較表がある場合は重複して新規比較表を追加しない。
- 「この記事でわかること」のcapbox内に比較表を入れない。
- 比較表内リンクにも `target="_blank"` と `rel="noopener noreferrer"` を付ける。
- 空セルを作らない。
- 抽象見出しを表に混ぜない。
- 推測で料金・条件・スペックを作らない。

## 基本HTML

```html
<div class="comparison-table-block" style="overflow-x: auto; width: 100%; -webkit-overflow-scrolling: touch;">
  <table border="1" cellpadding="10" cellspacing="0" style="width: 100%; table-layout: fixed;">
    <thead>
      <tr>
        <th style="width: 150px;">サービス名</th>
        <th style="width: 150px;">対応エリア</th>
        <th style="width: 150px;">出張査定</th>
        <th style="width: 150px;">費用感</th>
        <th style="width: 150px;">対応車種</th>
        <th style="width: 150px;">おすすめな人</th>
        <th style="width: 150px;">公式サイト・詳細</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>サービス名</strong></td>
        <td>対応エリア</td>
        <td>あり/なし/追加確認が必要</td>
        <td>無料/追加確認が必要</td>
        <td>対応車種</td>
        <td>おすすめな人</td>
        <td><a href="URL" target="_blank" rel="noopener noreferrer">公式サイト</a></td>
      </tr>
    </tbody>
  </table>
</div>
```

## 挿入位置

1. 「この記事でわかること」のcapboxが完全に閉じた直後
2. おすすめ・ランキング系H2の直前
3. 最初の比較・選び方系H2の直前

## change-logへの記録

- 比較表を挿入した位置
- 抽出した候補数
- 表に入れた項目数
- 情報不足で「追加確認が必要」とした項目
- 比較表を作成しなかった場合の理由
