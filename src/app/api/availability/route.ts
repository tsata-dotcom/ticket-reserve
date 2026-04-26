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
  const debugMode = searchParams.get('debug') === '1';

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

  const tourDefault = (tourRecord as { default_capacity?: number | null } | null)?.default_capacity;
  const tourDefaultCapacity: number =
    typeof tourDefault === 'number' && Number.isFinite(tourDefault)
      ? tourDefault
      : FALLBACK_CAPACITY;

  // reservations.tour_type は slug / name 混在
  const tourTypeValues = tourName
    ? Array.from(new Set([tourSlug, tourName]))
    : [tourSlug];

  const { data: reservations, error: resErr } = await supabase
    .from('reservations')
    .select('visit_date, time_slot, ticket_count')
    .in('tour_type', tourTypeValues)
    .eq('status', 'reserved')
    .gte('visit_date', startDate)
    .lte('visit_date', endDate);

  if (resErr) {
    console.error('[availability] reservations fetch error:', resErr);
  }

  // time_slot_settings の tour_type 列は slug と日本語名のどちらが入っているか
  // 環境によってブレる (ticket-system は name を書く設計だが、過去の挙動で slug が
  // 残っているケースもある)。両方を IN フィルタで拾えば取りこぼさない。
  // また tour_types に該当 slug が無く tourName が解決できなかった場合でも、
  // 少なくとも slug でヒットさせるチャンスを残す。
  const settingsTourTypeKeys = Array.from(
    new Set([tourSlug, ...(tourName ? [tourName] : [])])
  );

  let settings: Array<{
    date: string;
    slot: 'AM' | 'PM';
    capacity: number;
    is_active: boolean;
    tour_type: string;
  }> | null = null;

  let settingsFetchError: { message: string } | null = null;

  {
    const { data, error: settingsErr } = await supabase
      .from('time_slot_settings')
      .select('date, slot, capacity, is_active, tour_type')
      .in('tour_type', settingsTourTypeKeys)
      .gte('date', startDate)
      .lte('date', endDate);

    if (settingsErr) {
      console.error('[availability] time_slot_settings fetch error:', settingsErr);
      settingsFetchError = { message: settingsErr.message };
    }
    settings = data;
  }

  // debug モード時のみ、tour_type フィルタ無しで同期間の time_slot_settings を取得し、
  // 実際にどんな tour_type 値で行が入っているかを返す（slug↔name の表記ゆれ確認用）。
  let settingsUnfiltered: Array<Record<string, unknown>> | null = null;
  if (debugMode) {
    const { data: dataAll, error: errAll } = await supabase
      .from('time_slot_settings')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate);
    if (errAll) {
      console.error('[availability] unfiltered time_slot_settings fetch error:', errAll);
    }
    settingsUnfiltered = dataAll;
  }

  console.log(
    `[availability] slug=${tourSlug} -> name=${JSON.stringify(tourName)} | settings.length=${settings?.length ?? 0} | reservations.length=${reservations?.length ?? 0}`
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

    const amClosed = amSetting ? amSetting.is_active === false : false;
    const pmClosed = pmSetting ? pmSetting.is_active === false : false;

    const amCapacity = amSetting?.capacity ?? tourDefaultCapacity;
    const pmCapacity = pmSetting?.capacity ?? tourDefaultCapacity;

    const amReserved = (reservations || [])
      .filter(r => r.visit_date === dateStr && r.time_slot === 'AM')
      .reduce((sum, r) => sum + (r.ticket_count || 0), 0);

    const pmReserved = (reservations || [])
      .filter(r => r.visit_date === dateStr && r.time_slot === 'PM')
      .reduce((sum, r) => sum + (r.ticket_count || 0), 0);

    const amRemaining = amCapacity - amReserved;
    const pmRemaining = pmCapacity - pmReserved;

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

  if (debugMode) {
    return NextResponse.json({
      availability,
      debug: {
        request: { year, month, tourSlug, startDate, endDate },
        tourRecord, // null の場合は tour_types に該当 slug 無し
        tourName,
        tourDefaultCapacity,
        tourTypeValuesUsedForReservations: tourTypeValues,
        settingsTourTypeKeys, // time_slot_settings IN フィルタに使った値
        settingsFiltered: settings, // 上記キーでフィルタ済
        settingsFilteredCount: settings?.length ?? 0,
        settingsFetchError,
        settingsUnfiltered, // 期間内 全 tour_type の生データ
        settingsUnfilteredCount: settingsUnfiltered?.length ?? 0,
        settingsUnfilteredTourTypes: Array.from(
          new Set((settingsUnfiltered ?? []).map(s => String(s.tour_type)))
        ),
        reservationsCount: reservations?.length ?? 0,
      },
    });
  }

  return NextResponse.json({ availability });
}
