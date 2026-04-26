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
  // time_slot_settings.tour_type は ticket-system 側で日本語名 ('殻むき体験ツアー' 等)
  // で書き込まれているため、リクエストで来る slug を name にマッピングする必要がある。
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

  // default_capacity 列が tour_types に追加された場合だけ拾う（現状は undefined になる）
  const tourDefault = (tourRecord as { default_capacity?: number | null } | null)?.default_capacity;
  const tourDefaultCapacity: number =
    typeof tourDefault === 'number' && Number.isFinite(tourDefault)
      ? tourDefault
      : FALLBACK_CAPACITY;

  // reservations.tour_type は履歴上 slug (ticket-reserve 経由) と name (ticket-system 経由)
  // が混在している。どちらの経路の予約も残数集計に含めるため両方で IN フィルタする。
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

  // time_slot_settings は管理画面 (ticket-system) のみが書き込み、tour_type 列に
  // 日本語名で保存される。slug→name 変換に失敗した場合 (= 未知のスラッグ等) は
  // 設定が無いとみなしてフォールバック容量を使う。
  let settings: Array<{
    date: string;
    slot: 'AM' | 'PM';
    capacity: number;
    is_active: boolean;
    tour_type: string;
  }> | null = null;

  if (tourName) {
    const { data, error: settingsErr } = await supabase
      .from('time_slot_settings')
      .select('date, slot, capacity, is_active, tour_type')
      .eq('tour_type', tourName)
      .gte('date', startDate)
      .lte('date', endDate);

    if (settingsErr) {
      console.error('[availability] time_slot_settings fetch error:', settingsErr);
    }
    settings = data;
  }

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

    // is_active=false の行が「休止」を意味する。設定行が無い場合は営業扱い。
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

  return NextResponse.json({ availability });
}
