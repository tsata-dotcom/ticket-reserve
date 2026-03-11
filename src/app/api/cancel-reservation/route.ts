import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 });
  }

  const body = await request.json();
  const { reservation_id } = body;

  if (!reservation_id) {
    return NextResponse.json({ error: '予約IDが必要です' }, { status: 400 });
  }

  // Verify the reservation belongs to the user and is in the future
  const { data: reservation } = await supabase
    .from('reservations')
    .select('*')
    .eq('id', reservation_id)
    .eq('customer_id', user.id)
    .eq('status', 'reserved')
    .single();

  if (!reservation) {
    return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
  }

  const today = new Date().toISOString().split('T')[0];
  if (reservation.visit_date <= today) {
    return NextResponse.json({ error: '過去の予約はキャンセルできません' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('id', reservation_id);

  if (updateError) {
    return NextResponse.json({ error: 'キャンセルに失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
