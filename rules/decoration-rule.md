# SWELL記事装飾ルール

対象はバイク買取SEO記事の `articles/sample-article/rewritten.html` です。WordPressに貼り付け可能で、SWELLテーマで崩れにくいHTMLにしてください。

## 0. この記事でわかること

- 記事冒頭または最初のH2直前に「この記事でわかること」リストを1回だけ設置する。
- 記事内の主要H2へのアンカーリンク付きリストにする。
- SWELLのキャプションボックスを使う場合、比較表はcapboxの外に置く。

## 1. H2/H3アンカー

- すべてのH2に重複しない `id` を付与する。
- H2配下にH3が3つ以上ある場合、必要に応じてH3アンカーリンクリストを導入文直後に置く。
- 見出し文言は検索意図や元記事構成を壊さない範囲で自然に整える。

## 2. バイク買取記事で優先する装飾

- 比較表
- 査定前チェックリスト
- 必要書類リスト
- 注意点リスト
- メリット・デメリット表
- 出張査定の流れ
- 店舗持ち込みと出張買取の違い
- 不動車・事故車・原付・カスタム車の買取可否
- 契約前に確認すべきこと

## 3. SWELLキャプションボックス

重要なリストのみ、以下の構造で囲みます。通常の短い箇条書きまで過剰装飾しないでください。

```html
<!-- wp:loos/cap-block {"className":"is-style-onborder_ttl"} -->
<div class="swell-block-capbox cap_box is-style-onborder_ttl"><div class="cap_box_ttl"><span>タイトル</span></div><div class="cap_box_content"><!-- wp:list -->
<ul class="wp-block-list">
<li>項目</li>
</ul>
<!-- /wp:list --></div></div>
<!-- /wp:loos/cap-block -->
```

## 4. マーカー

- 重要な判断基準やメリットは `<span class="swl-marker mark_yellow">...</span>` を使う。
- 注意点やリスクは `<mark style="background-color:rgba(0, 0, 0, 0)" class="has-inline-color has-swl-deep-01-color">...</mark>` を使う。
- 1見出しブロックにつき原則1箇所まで。過剰装飾は禁止。

## 5. 補足吹き出し

- H2セクション末尾に、必要に応じて自然な補足吹き出しを設置する。
- 内容は「査定前に不安な点は事前に確認する」「書類が不足する場合は業者に相談する」「ローン残債は契約前に確認する」など、バイク買取読者の不安を補足するものにする。
- 同じ吹き出し文を複数箇所に貼り回さない。

## 6. 段落調整

- 長すぎる段落は、導入、具体例、注意点、結論など意味のまとまりで分割する。
- 極端に短い段落を量産しない。
- 意味を変えない。

## 7. 装飾後の確認

- H2/H3のidが重複していない。
- 「この記事でわかること」が1回だけ設置されている。
- 比較表がcapbox内に入っていない。
- 外部リンクは見出し内にない。
- 外部リンクに `target="_blank"` と `rel="noopener noreferrer"` がある。
- WordPressに貼り付け可能なHTMLになっている。
