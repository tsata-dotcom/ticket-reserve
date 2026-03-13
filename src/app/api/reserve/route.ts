import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { TOURS } from '@/lib/types';
import { sendQrEmail } from '@/lib/qr-mail';

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
    const { visit_date, time_slot, ticket_count, tour_type } = body;

    // サーバー側で初回無料判定（クライアントの値を信用しない）
    const { data: existingFreeReservations, error: checkError } = await supabase
      .from('reservations')
      .select('id')
      .eq('customer_id', user.id)
      .eq('total_amount', 0)
      .eq('status', 'reserved')
      .limit(1);

    if (checkError) {
      console.error('First-time check error:', checkError);
    }

    const isFirstTime = !existingFreeReservations || existingFreeReservations.length === 0;
    const tourInfo = TOURS.find(t => t.name === tour_type);
    const tourPrice = tourInfo?.price || 0;
    const unit_price = isFirstTime ? 0 : tourPrice;
    const total_amount = unit_price * ticket_count;

    // Get customer profile
    const { data: existingProfile, error: profileFetchError } = await supabase
      .from('customer_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileFetchError) {
      console.error('Profile fetch error:', profileFetchError);
    }

    let profile = existingProfile;

    // プロフィールがなければuser_metadataから自動作成
    if (!profile) {
      console.log('Profile not found, creating from user_metadata for user:', user.id);
      const meta = user.user_metadata;
      const { data: newProfile, error: profileError } = await supabase
        .from('customer_profiles')
        .upsert({
          id: user.id,
          display_name: meta?.display_name || user.email || '',
          email: user.email || '',
          phone: meta?.phone || '',
        }, { onConflict: 'id' })
        .select()
        .single();

      if (profileError || !newProfile) {
        console.error('プロフィール自動作成エラー:', profileError);
        profile = {
          display_name: meta?.display_name || user.email || '',
          email: user.email || '',
          phone: meta?.phone || '',
        };
      } else {
        profile = newProfile;
      }
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

    // Send email with QR code
    try {
      const emailResult = await sendQrEmail({
        to: profile.email,
        displayName: profile.display_name,
        orderNo,
        tourType: tour_type,
        visitDate: visit_date,
        timeSlot: time_slot,
        ticketCount: ticket_count,
        totalAmount: total_amount,
      });

      console.log('Email send result:', emailResult);

      // メール送信成功 → qr_sent を更新
      const { error: updateError } = await supabase
        .from('reservations')
        .update({ qr_sent: true, qr_sent_at: new Date().toISOString() })
        .eq('id', reservation.id);

      if (updateError) {
        console.error('qr_sent update error:', updateError);
      }
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
