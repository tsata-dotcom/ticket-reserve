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
  const availability: Record<string, { AM: { remaining: number; status: string }; PM: { remaining: number; status: string } }> = {};

  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const amSetting = settings?.find(s => s.date === dateStr && s.time_slot === 'AM');
    const pmSetting = settings?.find(s => s.date === dateStr && s.time_slot === 'PM');

    const amClosed = amSetting?.is_closed ?? false;
    const pmClosed = pmSetting?.is_closed ?? false;
    const amCapacity = amSetting?.capacity ?? DEFAULT_CAPACITY;
    const pmCapacity = pmSetting?.capacity ?? DEFAULT_CAPACITY;

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
