import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendQrEmail } from '@/lib/qr-mail';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

    const { reservation_id } = await request.json();
    if (!reservation_id) {
      return NextResponse.json({ error: 'reservation_idが必要です' }, { status: 400 });
    }

    // 予約を取得（本人確認）
    const { data: reservation, error: fetchError } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', reservation_id)
      .single();

    if (fetchError || !reservation) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }

    if (reservation.customer_id !== user.id) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }

    // QRメール再送信
    const emailResult = await sendQrEmail({
      to: reservation.buyer_email,
      displayName: reservation.buyer_name,
      orderNo: reservation.order_no,
      tourType: reservation.tour_type,
      visitDate: reservation.visit_date,
      timeSlot: reservation.time_slot,
      ticketCount: reservation.ticket_count,
      totalAmount: reservation.total_amount,
    });

    console.log('QR resend result:', emailResult);

    // qr_sent を更新
    await supabase
      .from('reservations')
      .update({ qr_sent: true, qr_sent_at: new Date().toISOString() })
      .eq('id', reservation_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Resend QR error:', error);
    return NextResponse.json({ error: 'メール再送信に失敗しました' }, { status: 500 });
  }
}
