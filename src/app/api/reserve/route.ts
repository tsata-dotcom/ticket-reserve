import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isWithinBookingRange, toBookingRangeConfig } from '@/lib/types';
import { sendQrEmail } from '@/lib/qr-mail';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function generateOrderNo(visitDate: string): Promise<string> {
  const dateStr = visitDate.replace(/-/g, '');
  const prefix = `WEB-${dateStr}-`;

  const { data } = await supabaseAdmin
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

    // tour_types からコース情報を取得（price/max_per_booking/has_first_visit_free/cancel_policy_*
    // と、ステップ3.5 の予約可能期間モード列）
    const { data: tourRecord, error: tourFetchError } = await supabase
      .from('tour_types')
      .select(
        'slug, name, price, max_per_booking, is_first_free, has_first_visit_free, is_active, cancel_policy_2days_rate, cancel_policy_1day_rate, cancel_policy_today_rate, booking_range_mode, booking_offset_start, booking_offset_end, booking_start_date, booking_end_date'
      )
      .eq('slug', tour_type)
      .maybeSingle();

    if (tourFetchError) {
      console.error('tour_types fetch error:', tourFetchError);
    }

    if (!tourRecord || !tourRecord.is_active) {
      return NextResponse.json({ error: '指定された体験コースが見つかりません' }, { status: 400 });
    }

    // ステップ3.5: ツアーごとの予約可能期間モードで判定する。
    //   - absolute: time_slot_settings にその日の有効行があれば OK
    //   - relative: tour_types の offset/period から計算した範囲で判定
    //   - null:     従来動作（今日+2日〜今日+1ヶ月）
    let absoluteDates: string[] | undefined;
    if (tourRecord.booking_range_mode === 'absolute') {
      const tourTypeKeys = Array.from(new Set([tourRecord.slug, tourRecord.name].filter(Boolean) as string[]));
      const { data: matchingSettings, error: settingsErr } = await supabaseAdmin
        .from('time_slot_settings')
        .select('date')
        .in('tour_type', tourTypeKeys)
        .eq('is_active', true)
        .eq('date', visit_date)
        .limit(1);
      if (settingsErr) {
        console.error('time_slot_settings fetch error:', settingsErr);
      }
      absoluteDates = (matchingSettings ?? []).length > 0 ? [visit_date] : [];
    }

    const bookingConfig = toBookingRangeConfig(tourRecord, absoluteDates);
    if (!isWithinBookingRange(visit_date, bookingConfig)) {
      return NextResponse.json(
        { error: 'ご予約可能な期間外の日付です' },
        { status: 400 }
      );
    }

    const count = Math.max(1, Math.floor(Number(ticket_count)));
    if (count > (tourRecord.max_per_booking || 1)) {
      return NextResponse.json(
        { error: `1予約あたり最大${tourRecord.max_per_booking}名までです` },
        { status: 400 }
      );
    }

    // SBペイメント連携後の方針:
    //   全顧客にオーソリ（与信確保）を実施し、初回来店時のみチェックイン時にオーソリ取消、
    //   2回目以降は売上確定。total_amount は常にツアー料金（割引なし）。
    //   旧スキーマの is_first_free / payment_method='free' は無料ルートとして残置。
    const unit_price = tourRecord.price;
    const total_amount = unit_price * count;

    // 旧無料ルート（price=0 のコース、または明示的に payment_method='free'）を保持。
    // ただしテスト試験時の判定にも対応するため、price > 0 は必ず決済要とする。
    const requiresPayment = total_amount > 0 && payment_method !== 'free';
    const finalPaymentMethod = requiresPayment ? 'card' : 'free';

    // Get / create customer profile
    const { data: existingProfile, error: profileFetchError } = await supabaseAdmin
      .from('customer_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileFetchError) {
      console.error('Profile fetch error:', profileFetchError);
    }

    let profile = existingProfile;

    if (!profile) {
      // 初回予約時にプロフィールが未作成のケース。anon key の upsert は RLS (42501)
      // で弾かれるので supabaseAdmin (service_role) で書き込む。id は認証ユーザー
      // 自身に固定するため他人のレコードを上書きする心配はない。
      const meta = user.user_metadata;
      const { data: newProfile, error: profileError } = await supabaseAdmin
        .from('customer_profiles')
        .upsert({
          id: user.id,
          display_name: meta?.display_name || '',
          email: user.email || '',
          phone: meta?.phone || '',
        }, { onConflict: 'id' })
        .select()
        .single();

      if (profileError || !newProfile) {
        console.error('プロフィール自動作成エラー:', profileError);
        profile = {
          display_name: meta?.display_name || '',
          email: user.email || '',
          phone: meta?.phone || '',
        };
      } else {
        profile = newProfile;
      }
    }

    const orderNo = await generateOrderNo(visit_date);

    // 表示名は futureshop_members の last_name/first_name を優先
    let displayName = profile.display_name;
    const lookupEmail = (profile.email || user.email || '').trim().toLowerCase();
    if (lookupEmail) {
      const { data: fsMember, error: fsErr } = await supabaseAdmin
        .from('futureshop_members')
        .select('last_name, first_name')
        .eq('email', lookupEmail)
        .maybeSingle();
      if (fsErr) {
        console.error('futureshop_members lookup error:', fsErr);
      }
      if (fsMember) {
        const fullName = `${fsMember.last_name ?? ''} ${fsMember.first_name ?? ''}`.trim();
        if (fullName) displayName = fullName;
      }
    }

    // キャンセルポリシースナップショット（予約時点の料率を凍結）
    const cancelPolicySnapshot = {
      '2days': Number(tourRecord.cancel_policy_2days_rate ?? 0),
      '1day': Number(tourRecord.cancel_policy_1day_rate ?? 0),
      today: Number(tourRecord.cancel_policy_today_rate ?? 0),
    };

    // 有料コースは決済オーソリ完了まで status='pending_payment' で保留する。
    // /api/payment/callback でオーソリ成功時に 'reserved' に昇格。NG時は 'payment_failed'。
    // これによりオーソリ未完了の予約がマイページに「予約済」として誤表示されるのを防ぐ。
    // ※ availability API は status != 'cancelled' で集計するため、pending_payment 中も
    //   枠は確保される（決済処理中の競合予約を防ぐ）。
    const insertPayload: Record<string, unknown> = {
      order_no: orderNo,
      buyer_name: displayName,
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
      status: requiresPayment ? 'pending_payment' : 'reserved',
      payment_method: finalPaymentMethod,
      cancel_policy_snapshot: cancelPolicySnapshot,
      payment_status: requiresPayment ? 'pending' : 'free',
      authorized_amount: requiresPayment ? total_amount : 0,
    };

    const { data: reservation, error: insertError } = await supabaseAdmin
      .from('reservations')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: '予約の作成に失敗しました' }, { status: 500 });
    }

    // 決済が必要なコースは、QRメール送信は決済オーソリ完了後（/api/payment/callback）で行う。
    // 無料ルートのみ即時にQRメール送信。
    if (!requiresPayment) {
      try {
        // 無料ルートはオーソリ自体が走らないため、初回無料の文言ではなく
        // 「料金 ¥0」相当の通常案内（料金表示は totalAmount=0）。
        // キャンセルポリシーは予約スナップショットを使う。
        const emailResult = await sendQrEmail({
          to: profile.email,
          displayName,
          orderNo,
          tourType: tourRecord.name,
          tourSlug: tourRecord.slug,
          visitDate: visit_date,
          timeSlot: time_slot,
          ticketCount: count,
          totalAmount: total_amount,
          isFirstVisitFree: false,
          cancelPolicy: cancelPolicySnapshot,
        });

        console.log('Email send result:', emailResult);

        const { error: updateError } = await supabaseAdmin
          .from('reservations')
          .update({ qr_sent: true, qr_sent_at: new Date().toISOString() })
          .eq('id', reservation.id);

        if (updateError) {
          console.error('qr_sent update error:', updateError);
        }
      } catch (emailError) {
        console.error('Email send error:', emailError);
      }
    }

    return NextResponse.json({
      reservation,
      requiresPayment,
      tourName: tourRecord.name,
    });
  } catch (error) {
    console.error('Reserve error:', error);
    return NextResponse.json({ error: '予約処理中にエラーが発生しました' }, { status: 500 });
  }
}
