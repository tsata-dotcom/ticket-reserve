-- 予約確定メール（QRメール）の件名テンプレートを payment_messages に登録。
-- 管理画面（ticket-system 側）から件名を編集できるようにする。
-- payment_messages テーブル本体は ticket-system 側 008_payment_system.sql で作成済み。

INSERT INTO payment_messages (message_key, message_text, description)
VALUES (
  'email_subject_reservation',
  '【かにファクトリー】{tourType} {visitDate}のご予約確定※チェックインQRコード付き',
  'お客様向け: 予約確定メールの件名。利用可能なプレースホルダー: {tourType} {visitDate} {timeSlot} {ticketCount} {orderNo} {displayName} {totalAmount}'
)
ON CONFLICT (message_key) DO NOTHING;
