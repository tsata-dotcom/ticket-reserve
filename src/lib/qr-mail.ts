import QRCode from 'qrcode';
import { sendMail } from './mailer';

export async function sendQrEmail(params: {
  to: string;
  displayName: string;
  orderNo: string;
  tourType: string;
  visitDate: string;
  timeSlot: string;
  ticketCount: number;
  totalAmount: number;
}) {
  const qrDataUrl = await QRCode.toDataURL(params.orderNo, { width: 200, margin: 2 });
  const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');

  const timeSlotLabel = params.timeSlot === 'AM' ? '午前の部（10:00〜11:30）' : '午後の部（14:00〜15:30）';

  const emailHtml = `
    <div style="font-family: 'Noto Sans JP', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #1a6985; font-size: 20px;">🦀 かにファクトリー 体験予約のご案内</h1>
      <p>${params.displayName} 様</p>
      <p>体験予約が完了しました。当日は下記のQRコードをご提示ください。</p>
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>受注番号:</strong> ${params.orderNo}</p>
        <p><strong>体験名:</strong> ${params.tourType}</p>
        <p><strong>日付:</strong> ${params.visitDate}</p>
        <p><strong>時間帯:</strong> ${timeSlotLabel}</p>
        <p><strong>参加人数:</strong> ${params.ticketCount}名</p>
        <p><strong>金額:</strong> ¥${params.totalAmount.toLocaleString()}</p>
      </div>
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
