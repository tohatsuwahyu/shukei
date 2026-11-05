# 作業時間集計システム

React / Node不要の、GitHub Pagesで動く静的Webアプリです。

## 現場の使い方

1. 作業者QRを最初に1回読む
2. 製品・現品票・トレーの Part QR を読む
3. 画面の 開始 を押す
4. 終われば 工程完了、続きが残れば 中断

物理的な開始QR・完了QR・工程QRは使いません。現場で必要なのは作業者QRとPart QRだけです。

- 二人作業は、二人がそれぞれ同じPart QRを開始。投入工数は別々に計算されます。
- 翌日に別の人が再開する場合も、同じPart QRを読むだけです。
- 材料切れ、設備トラブル、急ぎ仕事、NGは画面から理由を残します。

## 管理者

- 電脳工場からCSVを出力して、管理画面で一括取込
- Part QRを作成・印刷
- 工程別時間、作業者負荷、Part進捗、中断・NG、明細をCSVで出力

取込テンプレートの列：生産計画No. / Part QR / 図番 / 品名 / 数量 / 工程順

## Supabase接続

1. Supabaseでプロジェクトを作成
2. supabase.sql をSQL Editorで実行
3. 現場端末用のログインと管理者用のログインを作成
4. 管理者アカウントをSQL末尾の例に沿って admin に設定
5. config.js に Project URL と publishable key だけを入れる
6. 現場タブレットでは、最初に現場端末アカウントでログインしてから operator.html を開く

service_role / secret keyは、絶対にGitHub・HTML・JavaScriptへ書かないでください。