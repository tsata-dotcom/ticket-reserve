# SBペイメント決済実装設計書
## かにファクトリー チケット管理システム

最終更新: 2026年4月27日

---

## 1. 概要

### 利用環境
- **共用試験環境**: MID 30132 / SID 104（リンク+API型・指定売上）
- **接続先（リンク型）**: `https://stbfep.sps-system.com/f01/FepBuyInfoReceive.do`
- **接続先（API型）**: `https://stbfep.sps-system.com/api/xmlapi.do`
- **ハッシュキー（SID 104）**: `a23c0ef05956b20f8013d73b978fd1e93dc95341`
- **Basic認証 ID**: `30132104` / PW: `a23c0ef05956b20f8013d73b978fd1e93dc95341`
- **3DES暗号化キー**: `a23c0ef05956b20f8013d73b`
- **3DES初期化キー**: `978fd1e9`

### 仕様変更点（当初→現行）
- ~~初回は0円で予約完了~~ → **全顧客にクレジットカード入力・オーソリ（与信確保）を実施**
- 初回来店時：オーソリ取消（0円）
- 2回目以降来店時：売上確定（キャプチャ）
- 予約日2日前以降のキャンセル：キャンセルポリシーに従い請求（初回含む）

---

## 2. 決済フロー

### 2.1 予約時（全顧客共通）
予約ページ → [Form POST] → SBペイメント決済画面 → カード入力 → オーソリ（与信確保）→ 結果CGI (pagecon_url) で tracking_id 保存 → success_url にリダイレクト → 予約完了画面

使用API: リンク型 購入要求 (A01-1)
- pay_method: credit / pay_type: 0（都度課金）/ service_type: 0（売上）/ amount: ツアー料金（税込）

### 2.2 チェックイン時 — 2回目以降
管理画面 → チェックインボタン → API型 売上要求 (ST02-00201-101) → tracking_id で売上確定 → payment_status = captured

### 2.3 チェックイン時 — 初回
管理画面 → チェックインボタン（初回フラグ検知）→ API型 取消返金要求 (ST02-00303-101) → tracking_id でオーソリ取消 → payment_status = auth_cancelled

### 2.4 キャンセル（visit_date の2日前以降）
キャンセル料算出 → API型 売上要求 (ST02-00201-101) → pay_option_manage > amount にキャンセル料をセット → payment_status = cancel_charged

### 2.5 キャンセル（visit_date の2日前より前）
API型 取消返金要求 (ST02-00303-101) → オーソリ取消 → payment_status = cancelled

---

## 3. API仕様サマリ

### 3.1 リンク型 購入要求 (A01-1)
接続先: https://stbfep.sps-system.com/f01/FepBuyInfoReceive.do
送信メソッド: Form POST / 送信文字コード: Shift-JIS

必須項目: pay_method, merchant_id(30132), service_id(104), cust_code(kanifactory_{email_hash}), order_id(kanifactory_{reservation_id}), item_id({tour_type_slug}), amount, pay_type(0), service_type(0), success_url, cancel_url, error_url, pagecon_url, request_date(YYYYMMDDHHMISS), sps_hashcode

### 3.2 結果CGI (A02-1)
重要な返却項目: res_result(OK/NG), res_tracking_id(14桁), res_sps_cust_no, res_sps_payment_no, res_payinfo_key, res_payment_date, res_err_code

### 3.3 API型 売上要求 (ST02-00201-101)
tracking_id or sps_transaction_id で対象指定。pay_option_manage > amount で金額指定（部分キャプチャ可能）。

### 3.4 API型 取消返金要求 (ST02-00303-101)
tracking_id or sps_transaction_id で対象指定。オーソリ取消用。

### 3.5 決済結果参照要求 (MG01-00101-101)
tracking_id で照会。管理画面・接続テスト用。

---

## 4. キャンセルポリシー設計
方針：予約時スナップショット方式。予約確定時点のポリシーをreservationsにコピー保存。
tour_typesに cancel_policy_2days_rate / cancel_policy_1day_rate / cancel_policy_today_rate / has_first_visit_free を追加。

## 5. 初回判定ロジック
has_first_visit_free = true のコースにのみ適用。同一顧客（メールアドレス）× 同一tour_typeで、captured または cancel_charged の予約があれば2回目以降。

## 6. 確認ダイアログ
payment_messages テーブルで管理。{amount}, {cancel_fee}, {rate}, {buyer_name}, {visit_date}, {time_slot} はフロントエンドで動的置換。

## 7. payment_status の状態遷移
pending → authorized → captured / auth_cancelled / cancel_charged / cancelled

## 8. 注意事項
- 一意制約: cust_code, order_id は kanifactory_ プレフィクス付与
- 文字コード: リンク型はShift-JIS
- API接続テスト: MG01-00101-101に存在しないtracking_idを送信→エラーコード付きXMLが返れば接続OK
- pagecon_urlのセキュリティ: sps_hashcode検証と通信元IP 61.215.213.47 チェック
