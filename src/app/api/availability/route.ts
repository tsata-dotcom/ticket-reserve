import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 最終フォールバック。tour_types.default_capacity（現状スキーマに無し）も
// time_slot_settings の行も無い時だけ使う。
const FALLBACK_CAPACITY = 20;

// time_slot_settings.date は DATE 型 ('YYYY-MM-DD' 文字列で返る) だが、
// 将来 TIMESTAMP 等に変わってもズレないよう先頭10文字で正規化して比較する。
function normalizeDateString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, 10);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || '');
  const month = parseInt(searchParams.get('month') || '');
  const tourSlug = searchParams.get('tour_type') || '';

  if (!year || !month || !tourSlug) {
    return NextResponse.json({ error: 'year, month, tour_type are required' }, { status: 400 });
  }

  const t0 = Date.now();

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // フェーズ1: ツアー本体と休業日は互いに独立なので並列に取得する。
  // 元コードでは tour_types → reservations → settings → holidays を直列に
  // 走らせており 4 ラウンドトリップ分の遅延（数百ms × 4）が積み上がっていた。
  const [tourResp, holidayResp] = await Promise.all([
    supabase.from('tour_types').select('*').eq('slug', tourSlug).maybeSingle(),
    supabaseAdmin
      .from('holidays')
      .select('date')
      .gte('date', startDate)
      .lte('date', endDate),
  ]);

  const tourRecord = tourResp.data;
  if (tourResp.error) {
    console.error('[availability] tour_types fetch error:', tourResp.error);
  }
  if (holidayResp.error) {
    console.error('[availability] holidays fetch error:', holidayResp.error);
  }

  const tourName: string | null =
    (tourRecord as { name?: string | null } | null)?.name ?? null;

  // default_capacity 列が tour_types に追加された場合だけ拾う（現状は undefined）
  const tourDefault = (tourRecord as { default_capacity?: number | null } | null)?.default_capacity;
  const tourDefaultCapacity: number =
    typeof tourDefault === 'number' && Number.isFinite(tourDefault)
      ? tourDefault
      : FALLBACK_CAPACITY;

  // ステップ3.5: ツアーごとの予約可能期間モード
  const tr = tourRecord as {
    booking_range_mode?: 'relative' | 'absolute' | null;
    booking_offset_start?: number | null;
    booking_offset_end?: number | null;
    booking_start_date?: string | null;
    booking_end_date?: string | null;
  } | null;
  const bookingMode = tr?.booking_range_mode ?? null;
  const isAbsolute = bookingMode === 'absolute';

  // reservations.tour_type は履歴上 slug (ticket-reserve 経由) と name (ticket-system 経由)
  // が混在しているため、両方を IN で拾う。
  const tourTypeValues = tourName
    ? Array.from(new Set([tourSlug, tourName]))
    : [tourSlug];

  // time_slot_settings の tour_type 列も slug / name の両方で拾う。
  // 現在 DB は slug 統一済み（ステップ1）。tour_types.name は保険として併用。
  const settingsTourTypeKeys = Array.from(
    new Set([tourSlug, ...(tourName ? [tourName] : [])])
  );

  // フェーズ2: ツアー情報が必要な reservations / time_slot_settings を並列で取得。
  // absolute モードでは時刻データを全期間取得し、月のレンダリング用 + absoluteDates
  // 用の二度クエリを排する（=従来5回→3回まで削減）。relative モードは引き続き
  // 月の範囲だけ取得する。
  // 枠を実際に消費するのは「正規の予約として確定したレコード」のみとする。
  // 'cancelled' に加えて以下も枠カウントから除外:
  //   - pending_payment: SBペイメント決済画面遷移中（callback で reserved に昇格）。
  //     これを枠消費させると、決済中の数秒〜離脱時間中、他のお客様が予約できなくなる。
  //   - payment_failed: 決済失敗。実体は予約成立していない。
  //   - expired:        /api/payment/cleanup で時間切れにした pending_payment。
  // 残る reserved / checked_in / confirmed 等は引き続き枠消費としてカウントする。
  const settingsQuery = isAbsolute
    ? supabase
        .from('time_slot_settings')
        .select('date, slot, capacity, is_active, tour_type')
        .in('tour_type', settingsTourTypeKeys)
    : supabase
        .from('time_slot_settings')
        .select('date, slot, capacity, is_active, tour_type')
        .in('tour_type', settingsTourTypeKeys)
        .gte('date', startDate)
        .lte('date', endDate);

  const [resResp, settingsResp] = await Promise.all([
    supabaseAdmin
      .from('reservations')
      .select('visit_date, time_slot, ticket_count')
      .in('tour_type', tourTypeValues)
      .not('status', 'in', '("cancelled","expired","payment_failed","pending_payment")')
      .gte('visit_date', startDate)
      .lte('visit_date', endDate),
    settingsQuery,
  ]);

  const reservations = resResp.data;
  if (resResp.error) {
    console.error('[availability] reservations fetch error:', resResp.error);
  }
  if (settingsResp.error) {
    console.error('[availability] time_slot_settings fetch error:', settingsResp.error);
  }

  // 月レンダリング用には当月分だけに絞る。absolute では allSettings を流用。
  const allSettings = settingsResp.data ?? [];
  const settings = isAbsolute
    ? allSettings.filter(s => {
        const d = normalizeDateString(s.date);
        return d >= startDate && d <= endDate;
      })
    : allSettings;

  // 休業日: ticket-system 側で /slot-management の「休業日管理」から登録される。
  // 該当日は AM/PM とも remaining=0 / status='closed' で返す（time_slot_settings に
  // 行が無くても holidays に入っていれば閉鎖扱い）。
  // holidays は anon に SELECT ポリシーが無く、anon クライアントだと
  // 静かに空配列が返って休業日が反映されない。RLS をバイパスするため
  // service_role の supabaseAdmin で読む（公開情報なので問題なし）。
  const holidayRows = holidayResp.data;

  const holidaySet = new Set(
    (holidayRows ?? [])
      .map(h => normalizeDateString(h.date))
      .filter(d => d.length === 10)
  );

  // Build availability map
  const availability: Record<
    string,
    { AM: { remaining: number; status: string }; PM: { remaining: number; status: string } }
  > = {};

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const amSetting = settings?.find(
      s => normalizeDateString(s.date) === dateStr && s.slot === 'AM'
    );
    const pmSetting = settings?.find(
      s => normalizeDateString(s.date) === dateStr && s.slot === 'PM'
    );

    const isHoliday = holidaySet.has(dateStr);

    // 休業日 or is_active=false の行は閉鎖扱い。
    // ステップ3.5: absolute モードでは time_slot_settings に行が無い日も閉鎖扱い
    //   （プレオープン等の固定日イベント。FALLBACK_CAPACITY は適用しない）
    // relative モードでは従来通り、設定行が無くても営業扱い（FALLBACK_CAPACITY を適用）。
    const amClosed = isHoliday || (amSetting ? amSetting.is_active === false : isAbsolute);
    const pmClosed = isHoliday || (pmSetting ? pmSetting.is_active === false : isAbsolute);

    const amCapacity = amSetting?.capacity ?? (isAbsolute ? 0 : tourDefaultCapacity);
    const pmCapacity = pmSetting?.capacity ?? (isAbsolute ? 0 : tourDefaultCapacity);

    const amReserved = (reservations || [])
      .filter(r => r.visit_date === dateStr && r.time_slot === 'AM')
      .reduce((sum, r) => sum + (r.ticket_count || 0), 0);

    const pmReserved = (reservations || [])
      .filter(r => r.visit_date === dateStr && r.time_slot === 'PM')
      .reduce((sum, r) => sum + (r.ticket_count || 0), 0);

    // 休業日は確実に「枠 0 / closed」を返す。capacity 計算より優先。
    const amRemaining = amClosed ? 0 : amCapacity - amReserved;
    const pmRemaining = pmClosed ? 0 : pmCapacity - pmReserved;

    const getStatus = (remaining: number, closed: boolean) => {
      if (closed) return 'closed';
      if (remaining <= 0) return 'full';
      if (remaining <= 5) return 'few';
      return 'available';
    };

    availability[dateStr] = {
      AM: { remaining: Math.max(0, amRemaining), status: getStatus(amRemaining, amClosed) },
      PM: { remaining: Math.max(0, pmRemaining), status: getStatus(pmRemaining, pmClosed) },
    };
  }

  // ステップ3.5: absolute モードは time_slot_settings に行がある日付一覧を全期間で返す。
  // Calendar 側がこの一覧から最小日〜最大日（カレンダー表示範囲）を決める。
  // フェーズ2 で全期間の settings を既に取得済みなので、追加クエリ不要で
  // メモリ上でフィルタするだけ。
  let absoluteDates: string[] | undefined;
  if (isAbsolute) {
    absoluteDates = Array.from(
      new Set(
        allSettings
          .filter(s => s.is_active !== false)
          .map(s => normalizeDateString(s.date))
          .filter(d => d.length === 10)
      )
    ).sort();
  }

  console.log(`[availability] tour=${tourSlug} ${year}-${month} took ${Date.now() - t0}ms`);

  return NextResponse.json({
    availability,
    bookingRange: {
      mode: bookingMode,
      offsetStart: tr?.booking_offset_start ?? null,
      offsetEnd: tr?.booking_offset_end ?? null,
      startDate: tr?.booking_start_date ?? null,
      endDate: tr?.booking_end_date ?? null,
      absoluteDates,
    },
  });
}
