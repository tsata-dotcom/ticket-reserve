import QRCode from 'qrcode';
import { sendMail } from './mailer';

export type CancelPolicySnapshot = {
  '2days'?: number;
  '1day'?: number;
  today?: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderPaymentSection(params: {
  isFirstVisitFree: boolean;
  totalAmount: number;
}): string {
  if (params.isFirstVisitFree) {
    return `
      <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
        <p style="font-weight: bold; color: #065f46; margin: 0 0 6px 0;">【お支払いについて】</p>
        <p style="margin: 0; color: #064e3b; line-height: 1.6;">
          初回無料でご体験いただけます。ご来店時に課金は発生しません。<br />
          ※キャンセルされる場合は以下のキャンセルポリシーが適用されます。
        </p>
      </div>
    `;
  }
  return `
    <div style="background: #eff6ff; border-left: 4px solid #1a6985; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
      <p style="font-weight: bold; color: #1e3a8a; margin: 0 0 6px 0;">【お支払いについて】</p>
      <p style="margin: 0; color: #1e40af; line-height: 1.6;">
        ご予約金額: <strong>¥${params.totalAmount.toLocaleString()}</strong>（税込）<br />
        チェックイン時にご登録のクレジットカードへご請求となります。
      </p>
    </div>
  `;
}

function renderCancelPolicySection(policy: CancelPolicySnapshot | null): string {
  if (!policy) return '';
  const twoDays = policy['2days'] ?? 0;
  const oneDay = policy['1day'] ?? 0;
  const today = policy.today ?? 0;
  return `
    <div style="background: #fafafa; border: 1px solid #e5e7eb; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
      <p style="font-weight: bold; color: #374151; margin: 0 0 6px 0;">【キャンセルポリシー】</p>
      <ul style="margin: 0; padding-left: 18px; color: #374151; line-height: 1.7;">
        <li>2日前まで: 無料</li>
        <li>2日前: ツアー料金の${twoDays}%</li>
        <li>前日: ツアー料金の${oneDay}%</li>
        <li>当日: ツアー料金の${today}%</li>
      </ul>
    </div>
  `;
}

export async function sendQrEmail(params: {
  to: string;
  displayName: string;
  orderNo: string;
  tourType: string;
  visitDate: string;
  timeSlot: string;
  ticketCount: number;
  totalAmount: number;
  // Phase 2 (SBペイメント) で追加。未指定の旧ルート（無料コース予約）からの呼び出しでも
  // メールが壊れないように optional + デフォルト値で運用する。
  isFirstVisitFree?: boolean;
  cancelPolicy?: CancelPolicySnapshot | null;
}) {
  const qrDataUrl = await QRCode.toDataURL(params.orderNo, { width: 200, margin: 2 });
  const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');

  const timeSlotLabel = params.timeSlot === 'AM' ? '午前の部（10:00〜11:30）' : '午後の部（14:00〜15:30）';
  const isFirstVisitFree = params.isFirstVisitFree === true;

  const paymentSection = renderPaymentSection({
    isFirstVisitFree,
    totalAmount: params.totalAmount,
  });
  const cancelSection = renderCancelPolicySection(params.cancelPolicy ?? null);

  const emailHtml = `
    <div style="font-family: 'Noto Sans JP', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #1a6985; font-size: 20px;">🦀 かにファクトリー 体験予約のご案内</h1>
      <p>${escapeHtml(params.displayName)} 様</p>
      <p>体験予約が完了しました。当日は下記のQRコードをご提示ください。</p>
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>受注番号:</strong> ${escapeHtml(params.orderNo)}</p>
        <p><strong>体験名:</strong> ${escapeHtml(params.tourType)}</p>
        <p><strong>日付:</strong> ${escapeHtml(params.visitDate)}</p>
        <p><strong>時間帯:</strong> ${timeSlotLabel}</p>
        <p><strong>参加人数:</strong> ${params.ticketCount}名</p>
        <p><strong>金額:</strong> ¥${params.totalAmount.toLocaleString()}</p>
      </div>
      ${paymentSection}
      ${cancelSection}
      <div style="text-align: center; margin: 20px 0;">
        <img src="cid:qrcode" alt="QRコード" width="200" height="200" />
      </div>
      <p style="color: #666; font-size: 14px;">※このメールは自動送信です。ご不明な点がございましたら、施設まで直接お問い合わせください。</p>
    </div>
  `;

  return sendMail({
    to: params.to,
    subject: '【かにファクトリー】体験予約のご案内',
    html: emailHtml,
    attachments: [
      {
        filename: 'qrcode.png',
        content: qrBase64,
        content_type: 'image/png',
        cid: 'qrcode',
      },
    ],
  });
}
