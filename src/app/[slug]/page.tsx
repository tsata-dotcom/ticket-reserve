import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import { TourTypeRecord } from '@/lib/types';
import TourBookingFlow from './TourBookingFlow';

interface PageProps {
  params: { slug: string };
}

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export default async function TourSlugPage({ params }: PageProps) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: tour, error } = await supabase
    .from('tour_types')
    .select('*')
    .eq('slug', params.slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[/[slug]] tour_types fetch error:', error);
  }

  if (!tour) {
    notFound();
  }

  const tourRecord = tour as TourTypeRecord;

  // absolute モードのツアーは初回 /api/availability 応答を待つと
  // カレンダーが数秒ブランクになるため、ここで absoluteDates を SSR で
  // 先読みして子に渡す。relative モードは追加クエリ不要。
  let initialAbsoluteDates: string[] | undefined;
  if (tourRecord.booking_range_mode === 'absolute') {
    const settingsKeys = Array.from(
      new Set([tourRecord.slug, tourRecord.name].filter(Boolean) as string[])
    );
    const { data: settingsRows, error: settingsErr } = await supabase
      .from('time_slot_settings')
      .select('date')
      .in('tour_type', settingsKeys)
      .eq('is_active', true);
    if (settingsErr) {
      console.error('[/[slug]] absoluteDates fetch error:', settingsErr);
    }
    initialAbsoluteDates = Array.from(
      new Set(
        (settingsRows ?? [])
          .map(r => (typeof r.date === 'string' ? r.date.slice(0, 10) : ''))
          .filter(d => d.length === 10)
      )
    ).sort();
  }

  return (
    <TourBookingFlow
      tour={tourRecord}
      initialAbsoluteDates={initialAbsoluteDates}
    />
  );
}
