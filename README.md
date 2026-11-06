# TSH FLOW — 作業時間集計システム

React / Node 不要の、GitHub Pages で動く静的Webアプリです（Supabase連携）。

## 現場の使い方
1. 作業者QRを最初に1回読む
2. 製品・現品票・トレーの Part QR を読む
3. 画面の **開始** → 終われば **工程完了**、続きが残れば **中断**

- 二人作業は、二人がそれぞれ同じPart QRを開始（投入工数は別々に計算）。
- 翌日に別の人が再開する場合も、同じPart QRを読むだけ。
- 日本語 / Bahasa Indonesia 切替、USB/Bluetoothバーコードリーダー、コード手入力に対応。
- 一定時間操作がないと作業者は自動解除（共有タブレットでの取り違え防止）。

## 管理者・生産管理
- 電脳工場CSVを内容確認つきで取込（既存Partの進捗は保持）
- Part QRをまとめて印刷 / 作業者QRの発行・再発行
- 実績・分析（標準時間比較・中断/NG・納期遅れ・終了忘れの強制終了）、現場モニター

## セットアップ
1. Supabaseでプロジェクト作成 → `supabase.sql` をSQL Editorで実行
2. `supabase/migrations/` を **日付順にすべて** 実行（最新: `20261106130000_ops_hardening.sql`）
3. Edge Function `operator-gateway` をデプロイ（`verify_jwt = false`）
   - 別ドメインで試す場合のみ環境変数 `ALLOWED_ORIGINS` にOriginを追加
4. 管理者・生産管理のログインを作成し、管理者は `profiles.role = 'admin'` に設定
5. `config.js` に Project URL と publishable key だけを入れる

現場タブレットは **ログイン不要**（作業者QRで認証）。`service_role` / secret key は絶対にGitHub・HTML・JSへ書かないでください。

## 開発メモ
- 外部ライブラリは `vendor/` に固定バージョンで同梱（CDN障害・改ざんの影響を受けません）。
- CSS/JSを更新したら、各HTMLの `?v=` の値を変えてキャッシュを更新してください。
- 日付の集計は常に日本時間（Asia/Tokyo）基準です。

## 休憩時間・出来高（良品/NG）

- 休憩時間は「マスタ」画面の「休憩時間」で設定します。実作業時間・タイマー・CSVから自動で差し引かれます。
- 「工程完了」を押すと、良品数とNG数の入力画面が開きます（良品の初期値は予定数量）。実績画面とCSVに表示されます。
- 適用手順：`supabase/migrations/20261106150000_breaks_and_qty.sql` をSQL Editorで実行 → Edge Function `operator-gateway` を再デプロイ。
- 終業時の自動中断（任意）：`supabase/optional/optional_autopause_cron.sql` を参照。
