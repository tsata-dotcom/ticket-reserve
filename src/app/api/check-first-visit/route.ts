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

// 初回無料判定。同一 email × 同一 tour_type で payment_status が
//   authorized / captured / cancel_charged / auth_cancelled のいずれかの
//   予約が1件でもあれば「2回目以降」（isFirstVisit=false）。
// reservations.tour_type は slug 統一済み（ステップ1）なので slug の eq で十分。
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const tourType = searchParams.get('tour_type');

  if (!email || !tourType) {
    return NextResponse.json(
      { error: 'email と tour_type は必須です' },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from('reservations')
    .select('id')
    .eq('buyer_email', email.trim().toLowerCase())
    .eq('tour_type', tourType)
    .in('payment_status', ['authorized', 'captured', 'cancel_charged', 'auth_cancelled'])
    .limit(1);

  if (error) {
    console.error('[check-first-visit] query error:', error);
    return NextResponse.json(
      { error: '初回判定に失敗しました' },
      { status: 500 }
    );
  }

  const isFirstVisit = !data || data.length === 0;
  return NextResponse.json({ isFirstVisit });
}
