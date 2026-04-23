import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isWithinBookingRange } from '@/lib/types';
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
    const { visit_date, time_slot, ticket_count, tour_type, payment_method } = body;

    if (!visit_date || !time_slot || !ticket_count || !tour_type) {
      return NextResponse.json({ error: '必要な項目が不足しています' }, { status: 400 });
    }

    if (time_slot !== 'AM' && time_slot !== 'PM') {
      return NextResponse.json({ error: '時間帯の指定が不正です' }, { status: 400 });
    }

    // 予約可能日のサーバー側バリデーション（本日+2日 〜 本日+1ヶ月）
    if (!isWithinBookingRange(visit_date)) {
      return NextResponse.json(
        { error: 'ご予約は2日後から1ヶ月先までの日付をお選びください' },
        { status: 400 }
      );
    }

    // tour_types からコース情報を取得（price/max_per_booking/is_first_free）
    const { data: tourRecord, error: tourFetchError } = await supabase
      .from('tour_types')
      .select('slug, name, price, max_per_booking, is_first_free, is_active')
      .eq('slug', tour_type)
      .maybeSingle();

    if (tourFetchError) {
      console.error('tour_types fetch error:', tourFetchError);
    }

    if (!tourRecord || !tourRecord.is_active) {
      return NextResponse.json({ error: '指定された体験コースが見つかりません' }, { status: 400 });
    }

    const count = Math.max(1, Math.floor(Number(ticket_count)));
    if (count > (tourRecord.max_per_booking || 1)) {
      return NextResponse.json(
        { error: `1予約あたり最大${tourRecord.max_per_booking}名までです` },
        { status: 400 }
      );
    }

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
    const applyFirstFree = !!tourRecord.is_first_free && isFirstTime;
    const unit_price = applyFirstFree ? 0 : tourRecord.price;
    const total_amount = unit_price * count;

    // 決済未対応: 現状は無料ルートのみ予約確定を許可する。
    const finalPaymentMethod = applyFirstFree ? 'free' : (payment_method || 'free');
    if (finalPaymentMethod !== 'free') {
      return NextResponse.json(
        { error: '現在クレジットカード決済は準備中です' },
        { status: 400 }
      );
    }

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
        ticket_count: count,
        tour_type: tourRecord.slug,
        unit_price,
        total_amount,
        customer_id: user.id,
        booking_source: 'web',
        status: 'reserved',
        payment_method: finalPaymentMethod,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: '予約の作成に失敗しました' }, { status: 500 });
    }

    // メールにはスラッグではなく表示名を渡す
    try {
      const emailResult = await sendQrEmail({
        to: profile.email,
        displayName: profile.display_name,
        orderNo,
        tourType: tourRecord.name,
        visitDate: visit_date,
        timeSlot: time_slot,
        ticketCount: count,
        totalAmount: total_amount,
      });

      console.log('Email send result:', emailResult);

      const { error: updateError } = await supabase
        .from('reservations')
        .update({ qr_sent: true, qr_sent_at: new Date().toISOString() })
        .eq('id', reservation.id);

      if (updateError) {
        console.error('qr_sent update error:', updateError);
      }
    } catch (emailError) {
      console.error('Email send error:', emailError);
    }

    return NextResponse.json({ reservation });
  } catch (error) {
    console.error('Reserve error:', error);
    return NextResponse.json({ error: '予約処理中にエラーが発生しました' }, { status: 500 });
  }
}
