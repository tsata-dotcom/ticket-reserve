import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const origin = req.nextUrl.origin;

  if (code) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    try {
      await supabase.auth.exchangeCodeForSession(code);
    } catch (e) {
      console.error('[auth/callback] Code exchange error:', e);
    }
  }

  // トップページにリダイレクト（クライアント側でセッション検出）
  return NextResponse.redirect(origin);
}
