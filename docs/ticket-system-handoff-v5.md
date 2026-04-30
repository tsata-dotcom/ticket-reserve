# チケット管理システム 開発引き継ぎまとめ（v5）
最終更新: 2026年4月30日

---

## リポジトリ情報

| リポジトリ | URL | 用途 |
|---|---|---|
| ticket-reserve | github.com/tsata-dotcom/ticket-reserve | 予約ページ（reserve.kanifactory.com） |
| ticket-system | github.com/tsata-dotcom/ticket-system | 管理画面（kanifactory-ticket-check.vercel.app） |

- Supabase: https://xsvyyfotyawwrkulxujg.supabase.co（プロジェクト名: ticket-system、PRODUCTION）
- 両リポジトリとも同一Supabaseプロジェクトを参照

---

## 今回のセッション（v4→v5）で完了した作業

### SBペイメント決済連携（全体）

SBペイメントサービスのクレジットカード決済をリンク型+API型（指定売上）で実装。
共用試験環境（MID: 30132 / SID: 104）で全シナリオのテストを完了。

#### 決済フロー概要
1. 予約時 → リンク型でSBペイメント決済画面に遷移 → カード入力 → オーソリ（与信確保）
2. 結果CGI（pagecon_url）でDB更新 → status を 'reserved' に昇格
3. チェックイン時 → 初回無料: オーソリ取消（¥0）/ 2回目以降: 売上確定
4. キャンセル時 → 2日前より前: オーソリ取消 / 2日前以降: キャンセル料請求

---

### Phase 1: DB・ユーティリティ・API接続テスト（ticket-system）

#### マイグレーション（008_payment_system.sql 実行済み）
- **tour_types テーブル追加カラム**: cancel_policy_2days_rate, cancel_policy_1day_rate, cancel_policy_today_rate, has_first_visit_free
- **reservations テーブル追加カラム**: sps_tracking_id, sps_transaction_id, payment_status, authorized_amount, captured_amount, is_first_visit, payment_completed_at, cancel_policy_snapshot
- **payment_messages テーブル新規作成**: message_key / message_text / description、初期データ8件（お客様向け4件、管理者向け4件）

#### ユーティリティ（両リポジトリ共通）
- `src/lib/sbpayment.ts` — ハッシュ生成、XML構築、API通信、売上確定・オーソリ取消・決済照会・接続テスト
- `src/lib/cancel-policy.ts` — キャンセル料算出（JST日数差ベース）

#### API接続テスト
- `/api-status` ページにSBペイメント接続テストカードを追加
- 決済結果参照要求（MG01-00101-101）でダミーtracking_idを送信して疎通確認

---

### Phase 2: 予約ページ側の決済フロー（ticket-reserve）

#### 新規ファイル
| ファイル | 役割 |
|----------|------|
| `src/app/api/payment/initiate/route.ts` | SBペイメント決済画面への自動POST HTML生成 |
| `src/app/api/payment/callback/route.ts` | 結果CGI受信（Shift-JISデコード + UTF-8ハッシュ検証） |
| `src/app/api/payment/cancel/route.ts` | お客様キャンセル処理（キャンセル料算出 + 決済操作） |
| `src/app/api/payment/cleanup/route.ts` | 期限切れpending_payment予約のクリーンアップ |
| `src/app/payment/success/page.tsx` | 決済完了画面（ポーリングで結果確認） |
| `src/app/payment/cancel/page.tsx` | 決済キャンセル画面 |
| `src/app/payment/error/page.tsx` | 決済エラー画面 |
| `src/middleware.ts` | SBペイメントからのPOSTをGETにリダイレクト（303 See Other） |

#### 既存ファイルの修正
- **Confirmation.tsx**: 予約確定前の確認ダイアログ（初回無料/有料の出し分け、キャンセルポリシー表示）
- **/api/reserve**: cancel_policy_snapshot保存、有料コースは status='pending_payment' で作成
- **/api/my-reservations**: pending_payment / payment_failed / expired を除外
- **/api/availability**: 枠カウントから cancelled / expired / payment_failed / pending_payment を除外
- **マイページ（mypage/page.tsx）**: 決済ステータス表示、キャンセルダイアログ
- **QRメール（qr-mail.ts）**: 決済情報・キャンセルポリシーをメール本文に追加

---

### Phase 3: 管理画面の決済操作（ticket-system）

#### 新規ファイル
| ファイル | 役割 |
|----------|------|
| `src/app/api/payment/capture/route.ts` | 売上確定 / 初回無料オーソリ取消 |
| `src/app/api/payment/void/route.ts` | 手動オーソリ取消 |
| `src/app/api/payment/admin-cancel/route.ts` | 管理者キャンセル（キャンセル料算出 + 決済操作） |
| `src/app/api/payment/status/route.ts` | SBペイメント決済照会 |
| `src/app/api/payment/refund/route.ts` | 返金（captured / cancel_charged 対応） |
| `src/app/api/payment/connection-test/route.ts` | SBペイメント接続テスト |
| `src/app/(admin)/payment-messages/page.tsx` | 決済メッセージ管理画面 |

#### 既存ファイルの修正
- **予約一覧（reservations/page.tsx）**: 決済ステータスバッジ、初回無料ラベル、予約詳細モーダルに決済情報セクション、管理者ツール（売上確定/オーソリ取消/決済照会/返金/キャンセル）
- **チェックイン画面（checkin/page.tsx）**: 決済操作統合（初回無料→オーソリ取消、有料→売上確定）、確認ダイアログ、二重チェックイン防止（4層防御）
- **体験コース管理**: キャンセルポリシー設定（3料率 + 初回無料トグル）
- **サイドバー**: 「決済メッセージ」メニュー追加

---

## テスト結果（全て合格）

### シナリオ1: 初回予約 → チェックイン（初回無料）
- ✅ 確認ダイアログに「初回無料」メッセージ表示
- ✅ SBペイメント決済画面でカード入力 → オーソリ成功
- ✅ success画面に「初回無料でご体験いただけます」表示
- ✅ 管理画面で「オーソリ済」+「初回無料」バッジ
- ✅ チェックインダイアログ「オーソリ取消（¥0）を実行」
- ✅ チェックイン後「取消済」バッジ

### シナリオ2: 2回目予約 → チェックイン（売上確定）
- ✅ 確認ダイアログに有料予約メッセージ + 金額表示
- ✅ チェックインダイアログ「売上確定 ¥3,000 を実行」
- ✅ 「売上確定」バッジ

### シナリオ3: キャンセル（キャンセル料なし）
- ✅ マイページからキャンセル → 「キャンセル料は発生しません」
- ✅ オーソリ取消 → 「キャンセル済」

### シナリオ4: キャンセル（キャンセル料あり）
- ✅ マイページからキャンセル → 「キャンセル料 ¥1,500（50%）」
- ✅ 部分キャプチャ → 「キャンセル料請求」

### 管理者キャンセル
- ✅ 管理画面の予約詳細からキャンセル → オーソリ取消
- ✅ SBペイメント決済管理ツールで「与信取消済み」を確認

### 二重チェックイン防止
- ✅ 4層防御で完備（QRスキャン時のステータスチェック、checked_in チェック、payment_status チェック、API側の409拒否）

### 決済メッセージ管理
- ✅ お客様向け/管理者向けタブ、プレースホルダー説明、プレビュー・保存機能

---

## SBペイメント技術メモ

### 接続情報（共用試験環境）
```
MID: 30132 / SID: 104（リンク+API型・指定売上）
リンク型接続先: https://stbfep.sps-system.com/f01/FepBuyInfoReceive.do
API型接続先: https://stbfep.sps-system.com/api/xmlapi.do
ハッシュキー: a23c0ef05956b20f8013d73b978fd1e93dc95341
Basic認証: 30132104 / a23c0ef05956b20f8013d73b978fd1e93dc95341
決済管理ツール: https://stbbo.sps-system.com/backoffice/login.do
  アカウント: 30132104 / uVtIj335
```

### ハッシュ計算の仕様（実測確認済み）
- **リクエスト（加盟店→SBペイメント）**: UTF-8でハッシュ計算
  - ただしHTMLフォームはShift-JISで送信（iconv.encodeでHTML全体をShift-JIS化）
  - item_nameのShift-JISバイト列をハッシュに使うのではなく、UTF-8文字列のまま連結してSHA1
- **結果CGI（SBペイメント→加盟店）**: UTF-8でハッシュ計算
  - bodyはShift-JISで届くので、percentDecodeToBuffer → iconv.decode('Shift_JIS') でUTF-8に変換してからハッシュ検証
- **画面返却（A03-1）**: Shift-JISでハッシュ計算（未実装、middlewareでPOST→GETリダイレクトしているため検証不要）

### リンク型購入要求のハッシュ連結順序
pay_method, merchant_id, service_id, cust_code, sps_cust_no, sps_payment_no, order_id, item_id, pay_item_id, item_name, tax, amount, pay_type, service_type, terminal_type, success_url, cancel_url, error_url, pagecon_url, free1, free2, free3, free_csv, request_date, limit_second

### 結果CGI（A02-1）のハッシュ連結順序
pay_method, merchant_id, service_id, cust_code, sps_cust_no, sps_payment_no, order_id, item_id, pay_item_id, item_name, tax, amount, pay_type, auto_charge_type, service_type, div_settele, last_charge_month, camp_type, tracking_id, terminal_type, free1, free2, free3, request_date, res_pay_method, res_result, res_tracking_id, res_sps_cust_no, res_sps_payment_no, res_payinfo_key, res_payment_date, res_err_code, res_date, limit_second

### request_dateのタイムゾーン
- VercelはUTCで動作するため、formatRequestDateでJST（UTC+9）に変換してからタイムスタンプ生成
- limit_second=600（10分）の範囲内にJSTで収まる必要がある

### order_id / cust_code のフォーマット
- order_id: `kf_` + UUID32文字ハイフン除去 = 35文字（38文字制限内）
- cust_code: `kanifactory_` + emailのSHA256先頭20文字

### payment_status の状態遷移
```
pending_payment → (callback OK) → authorized → captured（2回目以降チェックイン）
pending_payment → (callback OK) → authorized → auth_cancelled（初回チェックイン）
pending_payment → (callback OK) → authorized → cancel_charged（キャンセル料請求）
pending_payment → (callback OK) → authorized → cancelled（早期キャンセル）
pending_payment → (callback OK) → authorized → refunded（返金）
pending_payment → (callback NG) → payment_failed
pending_payment → (1時間経過) → expired
```

### 初回無料判定ロジック
- tour_types.has_first_visit_free === true のコースのみ適用
- 同一email × 同一tour_type で以下ステータスの予約があるか:
  - authorized（予約済み未チェックイン）
  - captured（売上確定済み）
  - cancel_charged（キャンセル料請求済み）
  - auth_cancelled（初回無料チェックイン済み）
- 上記のいずれかが存在 → 2回目以降（有料）
- 存在しない → 初回（無料）
- callbackでの判定時は自分自身のreservation_idをneq除外

### キャンセルポリシー
- tour_typesにマスター（cancel_policy_2days_rate / 1day_rate / today_rate）
- 予約時にcancel_policy_snapshotとしてJSONで凍結保存
- キャンセル料算出はサーバー側のみ（クライアント値改ざん防止）

---

## 残タスク（優先順）

### 本番移行準備（必須）
1. **Vercel Proプランへの移行** — Hobbyは商用利用不可、Cron Jobsも1日1回制限
2. **SBペイメント専用試験環境・本番環境への切り替え** — MID/SID/ハッシュキー/接続先URLの変更
3. **Vercel環境変数の本番値設定** — SBPAYMENT_* 7変数の更新
4. **SBPAYMENT_DEBUG=false に変更** — 本番ではデバッグログを無効化
5. **デバッグログの削除** — TODO コメント箇所のログ出力を削除（initiate / callback 内）
6. **Cron Jobs設定** — Proプラン移行後に /api/payment/cleanup を1時間ごとに実行

### UI改善
7. **RLSポリシー修正** — customer_profiles INSERTのRLSエラー（42501）→ service_role key対応
8. **リッチテキストエディタ導入** — 管理画面の注意書き・説明文にTipTap等
9. **ログアウト後のヘッダーリンク修正** — 動作確認未実施

### スマレジ連携
10. **スマレジ連携のテスト** — チェックイン → 取引登録テスト
11. **本番店舗のスマレジ登録** — かにファクトリー店舗をスマレジに登録

### 外部連携待ち
12. **CROSS POINT** — 売上データ連携・ポイント付与の可否回答待ち
13. **メグリアプリ会員証でのチェックイン対応** — CROSS POINT会員番号での予約検索

### その他
14. **管理画面の独自ドメイン設定**
15. **tour_typeの表記ゆれ統一** — reservationsテーブルにslugと日本語名が混在。slugに統一推奨

---

## 重要な技術メモ（v4から継続）

### テーブル構造の注意点
- **reservations**: date列は `visit_date`（dateではない）、人数は `ticket_count`（num_guestsではない）、`order_no` はNOT NULL
- **time_slot_settings**: 時間帯は `slot`（time_slotではない）、有効フラグは `is_active`（is_closedではない、意味も逆）
- **tour_type の表記ゆれ**: ticket-reserveはslug（karamuki-tour）で保存、ticket-systemは日本語名（殻むき体験ツアー）で保存。決済関連のAPIは .or(`slug.eq.X,name.eq.X`) で両対応済み

### RLSポリシーの注意
- time_slot_settings: publicロールの旧ポリシー（qual=NULL）は削除済み、新ポリシー「Allow public read access」（SELECT, USING(true)）に置き換え
- 新規テーブル作成時は必ずauthenticatedロール用のポリシーも追加すること

### Futureshop会員キャッシュの仕様（v3から継続）
- ハイブリッド方式: キャッシュ優先 → APIフォールバック
- 全件同期は初回のみ（58,430件完了済み）
- Futureshop API日時パラメータはJST・タイムゾーンなし形式が必須

### 環境変数一覧（SBペイメント関連）
```
# 両リポジトリ共通
SBPAYMENT_MERCHANT_ID=30132
SBPAYMENT_SERVICE_ID=104
SBPAYMENT_HASH_KEY=a23c0ef05956b20f8013d73b978fd1e93dc95341
SBPAYMENT_API_URL=https://stbfep.sps-system.com/api/xmlapi.do
SBPAYMENT_LINK_URL=https://stbfep.sps-system.com/f01/FepBuyInfoReceive.do
SBPAYMENT_BASIC_AUTH_ID=30132104
SBPAYMENT_BASIC_AUTH_PW=a23c0ef05956b20f8013d73b978fd1e93dc95341

# ticket-reserve のみ
NEXT_PUBLIC_RESERVE_URL=https://reserve.kanifactory.com
SBPAYMENT_SKIP_HASH_VERIFY=false
SBPAYMENT_DEBUG=true（本番では false）
PAYMENT_CLEANUP_SECRET=kanifactory-cleanup-secret-2026

# ticket-system のみ（Vercel Cron用、Proプラン移行後）
CRON_SECRET=（設定予定）
```

### テスト用カード情報（共用試験環境）
| ブランド | カード番号 | 有効期限 | セキュリティコード |
|----------|-----------|----------|------------------|
| VISA（フリクションレス） | 4000000000002701 | 2035/12 | 123 |
| VISA（チャレンジ） | 4000000000002503 | 2035/12 | 123（PW: 1234） |

**テスト後は必ず当日中にオーソリ取消を実施すること**

### 設計書
- `docs/sbpayment-implementation-spec.md` — 両リポジトリに配置済み
