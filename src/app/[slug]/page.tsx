import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import { TourTypeRecord } from '@/lib/types';
import TourBookingFlow from './TourBookingFlow';

interface PageProps {
  params: { slug: string };
}

export const dynamic = 'force-dynamic';

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

  return <TourBookingFlow tour={tour as TourTypeRecord} />;
}
