import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 最終フォールバック。tour_types.default_capacity も time_slot_settings も
// 取得できない場合だけ使う。
const FALLBACK_CAPACITY = 20;

// time_slot_settings.date は DATE 型なら 'YYYY-MM-DD'、TIMESTAMP/TIMESTAMPTZ 型なら
// ISO 8601 ('YYYY-MM-DDTHH:mm:ss+09:00' 等) で返るため、先頭10文字で正規化して比較する。
function normalizeDateString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, 10);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || '');
  const month = parseInt(searchParams.get('month') || '');
  const tourType = searchParams.get('tour_type') || '';
  const debugMode = searchParams.get('debug') === '1';
  const debugDate = searchParams.get('date'); // 任意。'YYYY-MM-DD' でその日のみログ詳細化

  if (!year || !month || !tourType) {
    return NextResponse.json({ error: 'year, month, tour_type are required' }, { status: 400 });
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  console.log(
    `[availability] request: year=${year} month=${month} tour=${tourType} range=${startDate}〜${endDate} debug=${debugMode} debugDate=${debugDate ?? 'n/a'}`
  );

  // tour_types からデフォルト定員を取得
  const { data: tourRecord, error: tourErr } = await supabase
    .from('tour_types')
    .select('*')
    .eq('slug', tourType)
    .maybeSingle();

  if (tourErr) {
    console.error('[availability] tour_types fetch error:', tourErr);
  }

  console.log('[availability] tourRecord keys:', tourRecord ? Object.keys(tourRecord) : 'null');
  console.log(
    '[availability] tourRecord.default_capacity:',
    (tourRecord as { default_capacity?: unknown } | null)?.default_capacity,
    'type:',
    typeof (tourRecord as { default_capacity?: unknown } | null)?.default_capacity
  );

  const tourDefault = (tourRecord as { default_capacity?: number | null } | null)?.default_capacity;
  const tourDefaultCapacity: number =
    typeof tourDefault === 'number' && Number.isFinite(tourDefault) ? tourDefault : FALLBACK_CAPACITY;

  console.log(`[availability] tourDefaultCapacity (in use): ${tourDefaultCapacity}`);

  // Get reservations for the month
  const { data: reservations, error: resErr } = await supabase
    .from('reservations')
    .select('visit_date, time_slot, ticket_count')
    .eq('tour_type', tourType)
    .eq('status', 'reserved')
    .gte('visit_date', startDate)
    .lte('visit_date', endDate);

  if (resErr) {
    console.error('[availability] reservations fetch error:', resErr);
  }

  // Get time slot settings for the month
  const { data: settings, error: settingsErr } = await supabase
    .from('time_slot_settings')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate);

  if (settingsErr) {
    console.error('[availability] time_slot_settings fetch error:', settingsErr);
  }

  console.log(`[availability] time_slot_settings rows fetched: ${settings?.length ?? 0}`);
  if (settings && settings.length > 0) {
    // 1行目だけサンプルとしてカラム構造と date の型/値を出す
    const sample = settings[0];
    console.log('[availability] settings[0] keys:', Object.keys(sample));
    console.log(
      '[availability] settings[0] date raw:',
      JSON.stringify(sample.date),
      'typeof:',
      typeof sample.date,
      'normalized:',
      normalizeDateString(sample.date)
    );
    // 全行ぶん簡略ダンプ
    settings.forEach((s, i) => {
      console.log(
        `[availability] settings[${i}] date=${JSON.stringify(s.date)} (norm=${normalizeDateString(s.date)}) time_slot=${JSON.stringify(s.time_slot)} capacity=${s.capacity} is_closed=${s.is_closed}`
      );
    });
  }

  // Build availability map
  const availability: Record<string, { AM: { remaining: number; status: string }; PM: { remaining: number; status: string } }> = {};

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const amSetting = settings?.find(
      s => normalizeDateString(s.date) === dateStr && s.time_slot === 'AM'
    );
    const pmSetting = settings?.find(
      s => normalizeDateString(s.date) === dateStr && s.time_slot === 'PM'
    );

    if (debugDate && debugDate === dateStr) {
      console.log(
        `[availability] match for ${dateStr}: amSetting=${JSON.stringify(amSetting) ?? 'undefined'} pmSetting=${JSON.stringify(pmSetting) ?? 'undefined'}`
      );
    }

    const amClosed = amSetting?.is_closed ?? false;
    const pmClosed = pmSetting?.is_closed ?? false;
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
        request: { year, month, tourType, startDate, endDate },
        tourRecord,
        tourDefaultCapacity,
        settingsCount: settings?.length ?? 0,
        settings, // raw rows ― date 列の生値と型を確認するため
        reservationsCount: reservations?.length ?? 0,
      },
    });
  }

  return NextResponse.json({ availability });
}
