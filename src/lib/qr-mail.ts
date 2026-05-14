import QRCode from 'qrcode';
import { sendMail } from './mailer';
import { supabaseAdmin } from './supabase-admin';
import { findTourSlot, formatSlotWithTime, getTourSlots } from './tour-slots';

export type CancelPolicySnapshot = {
  '2days'?: number;
  '1day'?: number;
  today?: number;
};

export interface QrEmailParams {
  to: string;
  displayName: string;
  orderNo: string;
  tourType: string;
  // tour_types.slug。tour_slots から時間帯ラベル / 時刻ラベルを引くのに使う。
  // 旧ルートからの呼び出しで未指定の場合は、slot_key をそのまま label にフォールバックする。
  tourSlug?: string;
  visitDate: string;
  timeSlot: string;
  ticketCount: number;
  totalAmount: number;
  // Phase 2 (SBペイメント) で追加。未指定の旧ルート（無料コース予約）からの呼び出しでも
  // メールが壊れないように optional + デフォルト値で運用する。
  isFirstVisitFree?: boolean;
  cancelPolicy?: CancelPolicySnapshot | null;
}

const DEFAULT_SUBJECT_TEMPLATE =
  '【かにファクトリー】{tourType} {visitDate}のご予約確定※チェックインQRコード付き';

function formatDateJP(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function replaceSubjectPlaceholders(
  template: string,
  params: QrEmailParams,
  slotLabelOnly: string
): string {
  // 呼び出し元は tour_types.name を params.tourType に入れて渡す（slug は別途 tourSlug に入る）。
  const tourTypeJP = params.tourType || '';
  const visitDateJP = formatDateJP(params.visitDate || '');
  return template
    .replace(/{tourType}/g, tourTypeJP)
    .replace(/{visitDate}/g, visitDateJP)
    .replace(/{timeSlot}/g, slotLabelOnly)
    .replace(/{ticketCount}/g, String(params.ticketCount || ''))
    .replace(/{orderNo}/g, params.orderNo || '')
    .replace(/{displayName}/g, params.displayName || '')
    .replace(
      /{totalAmount}/g,
      params.totalAmount ? `¥${params.totalAmount.toLocaleString()}` : ''
    );
}

async function fetchSubjectTemplate(): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin
      .from('payment_messages')
      .select('message_text')
      .eq('message_key', 'email_subject_reservation')
      .maybeSingle();
    if (error) {
      console.error('[qr-mail] subject template fetch error:', error);
      return DEFAULT_SUBJECT_TEMPLATE;
    }
    const text = (data as { message_text?: string } | null)?.message_text;
    return text && text.trim() !== '' ? text : DEFAULT_SUBJECT_TEMPLATE;
  } catch (e) {
    console.error('[qr-mail] subject template fetch threw:', e);
    return DEFAULT_SUBJECT_TEMPLATE;
  }
}

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

// プレオープンツアー（tour_slug === 'karamuki-tour-preopen'）専用の注記。
// 招待制で配布した直リンクから予約したお客様に、初回無料 / グランドオープン後は通常料金、
// という運用ルールを QRメール本文で改めて伝えるためのもの。
const PREOPEN_TOUR_SLUG = 'karamuki-tour-preopen';

function renderPreopenNoticeSection(tourSlug: string | undefined): string {
  if (tourSlug !== PREOPEN_TOUR_SLUG) return '';
  return `
    <div style="background: #fff7ed; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
      <p style="font-weight: bold; color: #92400e; margin: 0 0 6px 0;">【プレオープン特典】</p>
      <p style="margin: 0; color: #78350f; line-height: 1.6;">
        ※プレオープン体験は初回無料です。グランドオープン以降は通常料金となります。
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

export async function sendQrEmail(params: QrEmailParams) {
  const qrDataUrl = await QRCode.toDataURL(params.orderNo, { width: 200, margin: 2 });
  const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');

  // tour_slots からスロットラベル / 時刻ラベルを取得。
  // 件名は label のみ（時刻なし）、本文は "label（time_label）" 形式で出力する。
  // tourSlug 未指定（旧ルート）や DB に該当行が無い場合は slot_key をそのままラベルに使う。
  const slots = params.tourSlug ? await getTourSlots(supabaseAdmin, params.tourSlug) : [];
  const slotInfo = findTourSlot(slots, params.timeSlot);
  const slotLabelOnly = slotInfo.label;
  const timeSlotLabel = formatSlotWithTime(slotInfo.label, slotInfo.timeLabel);
  const isFirstVisitFree = params.isFirstVisitFree === true;

  const paymentSection = renderPaymentSection({
    isFirstVisitFree,
    totalAmount: params.totalAmount,
  });
  const preopenSection = renderPreopenNoticeSection(params.tourSlug);
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
      ${preopenSection}
      ${cancelSection}
      <div style="text-align: center; margin: 20px 0;">
        <img src="cid:qrcode" alt="QRコード" width="200" height="200" />
      </div>
      <p style="color: #666; font-size: 14px;">※このメールは自動送信です。ご不明な点がございましたら、施設まで直接お問い合わせください。</p>
    </div>
  `;

  const subjectTemplate = await fetchSubjectTemplate();
  const subject = replaceSubjectPlaceholders(subjectTemplate, params, slotLabelOnly);

  return sendMail({
    to: params.to,
    subject,
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
