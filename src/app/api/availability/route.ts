import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_CAPACITY = 20;

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
  const availability: Record<string, { morning: { remaining: number; status: string }; afternoon: { remaining: number; status: string } }> = {};

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const morningSetting = settings?.find(s => s.date === dateStr && s.time_slot === 'morning');
    const afternoonSetting = settings?.find(s => s.date === dateStr && s.time_slot === 'afternoon');

    const morningClosed = morningSetting?.is_closed ?? false;
    const afternoonClosed = afternoonSetting?.is_closed ?? false;
    const morningCapacity = morningSetting?.capacity ?? DEFAULT_CAPACITY;
    const afternoonCapacity = afternoonSetting?.capacity ?? DEFAULT_CAPACITY;

    const morningReserved = (reservations || [])
      .filter(r => r.visit_date === dateStr && r.time_slot === 'morning')
      .reduce((sum, r) => sum + (r.ticket_count || 0), 0);

    const afternoonReserved = (reservations || [])
      .filter(r => r.visit_date === dateStr && r.time_slot === 'afternoon')
      .reduce((sum, r) => sum + (r.ticket_count || 0), 0);

    const morningRemaining = morningCapacity - morningReserved;
    const afternoonRemaining = afternoonCapacity - afternoonReserved;

    const getStatus = (remaining: number, closed: boolean) => {
      if (closed) return 'closed';
      if (remaining <= 0) return 'full';
      if (remaining <= 5) return 'few';
      return 'available';
    };

    availability[dateStr] = {
      morning: { remaining: Math.max(0, morningRemaining), status: getStatus(morningRemaining, morningClosed) },
      afternoon: { remaining: Math.max(0, afternoonRemaining), status: getStatus(afternoonRemaining, afternoonClosed) },
    };
  }

  return NextResponse.json({ availability });
}
