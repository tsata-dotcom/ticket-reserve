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

  // status が 'pending_payment' / 'payment_failed' / 'expired' の予約はマイページから除外する。
  // - pending_payment: SBペイメントのオーソリ待ち（数秒で reserved に昇格する想定）
  // - payment_failed: 決済失敗。お客様には予約成立として見せない方が混乱が少ない。
  // - expired: 決済画面で離脱した古い pending_payment を /api/payment/cleanup で expired に落としたもの。
  // 管理画面 (ticket-system) 側は別途すべてのステータスを表示する。
  const { data: reservations, error } = await supabaseAdmin
    .from('reservations')
    .select('*')
    .eq('customer_id', user.id)
    .not('status', 'in', '("pending_payment","payment_failed","expired")')
    .order('visit_date', { ascending: false });

  console.log('[my-reservations] query result count:', reservations?.length, 'error:', error);
  console.log('[my-reservations] user.id:', user.id);

  if (error) {
    return NextResponse.json(
      { error: 'データの取得に失敗しました' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
        },
      }
    );
  }

  return NextResponse.json(
    { reservations },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'CDN-Cache-Control': 'no-store',
        'Vercel-CDN-Cache-Control': 'no-store',
      },
    }
  );
}
