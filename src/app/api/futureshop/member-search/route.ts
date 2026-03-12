import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { searchMemberByEmail } from '@/lib/futureshop-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  try {
    // Supabase Auth認証チェック
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: '認証が無効です' }, { status: 401 });
    }

    // メールアドレスパラメータ
    const email = req.nextUrl.searchParams.get('email');
    if (!email) {
      return NextResponse.json({ error: 'emailパラメータが必要です' }, { status: 400 });
    }

    console.log(`[member-search] Searching for: ${email}`);

    // Futureshop会員検索
    const member = await searchMemberByEmail(email);

    if (!member) {
      console.log(`[member-search] No member found for: ${email}`);
      return NextResponse.json({ error: '会員が見つかりません' }, { status: 404 });
    }

    console.log(`[member-search] Found member: ${member.memberId}`);

    return NextResponse.json({ member });
  } catch (e) {
    console.error('[member-search] Error:', e);
    return NextResponse.json(
      { error: 'Futureshop API連携エラー' },
      { status: 500 }
    );
  }
}
