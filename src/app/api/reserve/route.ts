import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function generateOrderNo(visitDate: string): Promise<string> {
  const dateStr = visitDate.replace(/-/g, '');
  const prefix = `WEB-${dateStr}-`;

  const { data } = await supabase
    .from('reservations')
    .select('order_no')
    .like('order_no', `${prefix}%`)
    .order('order_no', { ascending: false })
    .limit(1);

  let seq = 1;
  if (data && data.length > 0) {
    const lastSeq = parseInt(data[0].order_no.split('-').pop() || '0');
    seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 });
    }

    const body = await request.json();
    const { visit_date, time_slot, ticket_count, tour_type, unit_price, total_amount } = body;

    // Get customer profile
    const { data: profile } = await supabase
      .from('customer_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'プロフィールが見つかりません' }, { status: 400 });
    }

    const orderNo = await generateOrderNo(visit_date);

    const { data: reservation, error: insertError } = await supabase
      .from('reservations')
      .insert({
        order_no: orderNo,
        buyer_name: profile.display_name,
        buyer_email: profile.email,
        buyer_phone: profile.phone,
        visit_date,
        time_slot,
        ticket_count,
        tour_type,
        unit_price,
        total_amount,
        customer_id: user.id,
        booking_source: 'web',
        status: 'reserved',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: '予約の作成に失敗しました' }, { status: 500 });
    }

    // Send email with QR code via Resend
    try {
      const qrDataUrl = await QRCode.toDataURL(orderNo, { width: 200, margin: 2 });
      const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');

      const timeSlotLabel = time_slot === 'morning' ? '午前の部（10:00〜11:30）' : '午後の部（14:00〜15:30）';

      const emailHtml = `
        <div style="font-family: 'Noto Sans JP', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1a6985; font-size: 20px;">🦀 かにファクトリー 体験予約のご案内</h1>
          <p>${profile.display_name} 様</p>
          <p>体験予約が完了しました。当日は下記のQRコードをご提示ください。</p>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>受注番号:</strong> ${orderNo}</p>
            <p><strong>体験名:</strong> ${tour_type}</p>
            <p><strong>日付:</strong> ${visit_date}</p>
            <p><strong>時間帯:</strong> ${timeSlotLabel}</p>
            <p><strong>参加人数:</strong> ${ticket_count}名</p>
            <p><strong>金額:</strong> ¥${total_amount.toLocaleString()}</p>
          </div>
          <div style="text-align: center; margin: 20px 0;">
            <img src="cid:qrcode" alt="QRコード" width="200" height="200" />
          </div>
          <p style="color: #666; font-size: 14px;">※このメールは自動送信です。ご不明な点がございましたら、施設まで直接お問い合わせください。</p>
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev',
          to: [profile.email],
          subject: '【かにファクトリー】体験予約のご案内',
          html: emailHtml,
          attachments: [
            {
              content: qrBase64,
              filename: 'qrcode.png',
              content_id: 'qrcode',
            },
          ],
        }),
      });
    } catch (emailError) {
      console.error('Email send error:', emailError);
      // Don't fail the reservation if email fails
    }

    return NextResponse.json({ reservation });
  } catch (error) {
    console.error('Reserve error:', error);
    return NextResponse.json({ error: '予約処理中にエラーが発生しました' }, { status: 500 });
  }
}
