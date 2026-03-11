import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

  const { data: reservations, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('customer_id', user.id)
    .order('visit_date', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ reservations });
}
