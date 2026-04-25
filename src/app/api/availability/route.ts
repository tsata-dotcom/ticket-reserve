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
// 厳密一致 (s.date === dateStr) のままだと TIMESTAMP 型のときに find が常に外れ、
// 設定済み定員が読めず DEFAULT_CAPACITY にフォールバックしてしまう不具合になる。
function normalizeDateString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, 10);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || '');
  const month = parseInt(searchParams.get('month') || '');
  const tourType = searchParams.get('tour_type') || '';

  if (!year || !month || !tourType) {
    return NextResponse.json({ error: 'year, month, tour_type are required' }, { status: 400 });
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // tour_types からデフォルト定員を取得（time_slot_settings に該当行がない時の既定値）。
  // SELECT * しておけば default_capacity 列が無いスキーマでもエラーにならず、
  // undefined となって最終フォールバックに落ちる。
  const { data: tourRecord } = await supabase
    .from('tour_types')
    .select('*')
    .eq('slug', tourType)
    .maybeSingle();

  const tourDefault = (tourRecord as { default_capacity?: number | null } | null)?.default_capacity;
  const tourDefaultCapacity: number =
    typeof tourDefault === 'number' && Number.isFinite(tourDefault) ? tourDefault : FALLBACK_CAPACITY;

  // Get reservations for the month
  const { data: reservations } = await supabase
    .from('reservations')
    .select('visit_date, time_slot, ticket_count')
    .eq('tour_type', tourType)
    .eq('status', 'reserved')
    .gte('visit_date', startDate)
    .lte('visit_date', endDate);

  // Get time slot settings for the month
  const { data: settings } = await supabase
    .from('time_slot_settings')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate);

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

  return NextResponse.json({ availability });
}
