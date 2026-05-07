# CLAUDE.md — ticket-reserve（予約ページ）

## プロジェクト概要
かにファクトリー体験予約のお客様向け予約ページ。一般ユーザーが体験コースの予約・決済・マイページでの予約管理を行う。

- フレームワーク: Next.js 14 / TypeScript / Tailwind CSS
- DB: Supabase（PostgreSQL）— 共有プロジェクト（ticket-system と同一）
- ホスティング: Vercel
- 本番URL: reserve.kanifactory.com

## コーディング規約

### commit & push
- 指示の末尾に「commit & push してください」がある場合は必ず実行
- コミットメッセージは日本語で簡潔に

### リファクタリング
- バグ修正時はリファクタリングを同時に行わない
- リファクタリングは別途提案ベースで実施

### 選択肢の提示
- 明確な1つの方針で実装。選択肢を提示して質問しない

## 重要な技術ルール

### tour_type の表記ゆれ（最重要）
このリポジトリは tour_type を slug（karamuki-tour / my-hp）で送信・保存する。ただし管理画面（ticket-system）からは日本語名で保存されたデータもある。

**必須ルール:**
- DB から tour_type を取得して比較する際は slug と日本語名の両方を考慮
- `.eq("tour_type", value)` 単体は避け、`.in("tour_type", [slug, name])` パターンを使用
- 表示時は `toDisplayName()`（src/lib/types.ts）で日本語名に変換
- 初回無料判定（Confirmation.tsx / payment/callback）は `.in()` で slug/name 両対応済み

```typescript
// NG
.eq("tour_type", tour.slug)

// OK
.in("tour_type", [tour.slug, tour.name].filter(Boolean))
```

### Supabase クライアントの使い分け
- **通常の読み取り**: anon key クライアント
- **customer_profiles への書き込み**: `/api/customer-profile/upsert` API ルート経由（supabaseAdmin 使用）
- **holidays テーブルの取得**: supabaseAdmin を使用（anon key だと取得漏れが発生する既知問題。availability/route.ts で対応済み）
- supabaseAdmin（src/lib/supabase-admin.ts）は遅延初期化 Proxy 実装。SUPABASE_SERVICE_ROLE_KEY 未設定でも import で落ちない

### メール送信
- **さくらレンタルサーバーの PHP プロキシ経由で送信**
- エンドポイント: `https://kanifactory.com/api-proxy/send-mail.php`
- 認証: `X-Proxy-Secret` ヘッダー（PROXY_SECRET 環境変数）
- Resend SDK / Nodemailer は依存に存在するが**直接使用しない**（過去の残骸）
- メール件名は payment_messages テーブルから動的取得（message_key: email_subject_reservation）

### HTML コンテンツの表示
- tour_types.description / notice_text はリッチテキスト（HTML）で保存されている
- 表示時は `sanitizeRichText()`（src/lib/sanitize.ts）でサニタイズ後、`dangerouslySetInnerHTML` で描画
- 許可タグ: p / br / strong / em / u / a / span

### Next.js の注意
- API ルートで `request.headers` / `request.json()` を使う場合は `export const dynamic = 'force-dynamic'` を必ず追加
- proxy.ts（旧 middleware.ts）: SBペイメントからのPOSTをGETにリダイレクト（303 See Other）

## テーブル構造の注意点

| テーブル | 注意 |
|---------|------|
| reservations | date列は `visit_date`、人数は `ticket_count`、購入者名は `buyer_name`（customer_nameではない）、メールは `buyer_email`、電話は `buyer_phone` |
| time_slot_settings | 時間帯は `slot`、有効フラグは `is_active`（true=営業） |
| customer_profiles | INSERT は `/api/customer-profile/upsert` 経由。直接 INSERT 禁止（RLS で拒否される） |
| payment_messages | message_key でテンプレート取得。email_subject_reservation が件名テンプレート |

## SBペイメント決済フロー
1. 予約 → `/api/payment/initiate` → SBペイメント決済画面にリダイレクト
2. カード入力 → オーソリ（与信確保）
3. 結果CGI → `/api/payment/callback` → DB更新（status: reserved）→ QRメール送信
4. チェックイン時 → 売上確定（2回目以降）/ オーソリ取消（初回無料）
5. キャンセル時 → 2日前より前: オーソリ取消 / 2日前以降: キャンセル料請求

### ハッシュ計算
- リクエスト: UTF-8でハッシュ計算（HTMLフォームはShift-JISで送信）
- 結果CGI: Shift-JISで届く → UTF-8に変換してからハッシュ検証
- request_date: JSTに変換（Vercel は UTC）

## 環境変数
必須: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_RESERVE_URL / SBPAYMENT_* (7変数) / PROXY_URL / PROXY_SECRET / PAYMENT_CLEANUP_SECRET

## RPC 関数
- `search_reservations_by_phone(phone_digits text)`: 電話番号のハイフンを除去して LIKE 検索（ticket-system のチェックイン画面から使用）
