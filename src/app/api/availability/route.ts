import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // tour_types からコース名（time_slot_settings 検索キー）と既定容量を取得。
  const { data: tourRecord, error: tourErr } = await supabase
    .from('tour_types')
    .select('*')
    .eq('slug', tourSlug)
    .maybeSingle();

  if (tourErr) {
    console.error('[availability] tour_types fetch error:', tourErr);
  }

  const tourName: string | null =
    (tourRecord as { name?: string | null } | null)?.name ?? null;

  // default_capacity 列が tour_types に追加された場合だけ拾う（現状は undefined）
  const tourDefault = (tourRecord as { default_capacity?: number | null } | null)?.default_capacity;
  const tourDefaultCapacity: number =
    typeof tourDefault === 'number' && Number.isFinite(tourDefault)
      ? tourDefault
      : FALLBACK_CAPACITY;

  // reservations.tour_type は履歴上 slug (ticket-reserve 経由) と name (ticket-system 経由)
  // が混在しているため、両方を IN で拾う。
  const tourTypeValues = tourName
    ? Array.from(new Set([tourSlug, tourName]))
    : [tourSlug];

  // status はキャンセル以外を対象。'reserved' / 'confirmed' / その他いずれの enum
  // 値でも、キャンセル以外なら残数集計に含める (.eq('status', 'reserved') だと
  // 'confirmed' などが取りこぼされて 5/6 AM の test 予約が remaining から
  // 差し引かれない不具合になっていた)。
  const { data: reservations, error: resErr } = await supabase
    .from('reservations')
    .select('visit_date, time_slot, ticket_count')
    .in('tour_type', tourTypeValues)
    .neq('status', 'cancelled')
    .gte('visit_date', startDate)
    .lte('visit_date', endDate);

  if (resErr) {
    console.error('[availability] reservations fetch error:', resErr);
  }

  // time_slot_settings の tour_type 列も slug / name の両方で拾う。
  // ticket-system は name で書き込むが、過去データや別経路で slug が入っている
  // ケースもあるため。tourName が解決できなくても slug でヒットするチャンスを残す。
  const settingsTourTypeKeys = Array.from(
    new Set([tourSlug, ...(tourName ? [tourName] : [])])
  );

  const { data: settings, error: settingsErr } = await supabase
    .from('time_slot_settings')
    .select('date, slot, capacity, is_active, tour_type')
    .in('tour_type', settingsTourTypeKeys)
    .gte('date', startDate)
    .lte('date', endDate);

  if (settingsErr) {
    console.error('[availability] time_slot_settings fetch error:', settingsErr);
  }

  // 休業日: ticket-system 側で /slot-management の「休業日管理」から登録される。
  // 該当日は AM/PM とも remaining=0 / status='closed' で返す（time_slot_settings に
  // 行が無くても holidays に入っていれば閉鎖扱い）。
  const { data: holidayRows, error: holidaysErr } = await supabase
    .from('holidays')
    .select('date')
    .gte('date', startDate)
    .lte('date', endDate);

  if (holidaysErr) {
    console.error('[availability] holidays fetch error:', holidaysErr);
  }

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

    // 休業日 or is_active=false の行は閉鎖扱い。設定行が無く休業日でもなければ営業扱い。
    const amClosed = isHoliday || (amSetting ? amSetting.is_active === false : false);
    const pmClosed = isHoliday || (pmSetting ? pmSetting.is_active === false : false);

    const amCapacity = amSetting?.capacity ?? tourDefaultCapacity;
    const pmCapacity = pmSetting?.capacity ?? tourDefaultCapacity;

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

  return NextResponse.json({ availability });
}
