import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchMembersWithFallback } from '@/lib/futureshop-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'emailが必要です' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    console.log(`[member-check] Input: "${email}" -> normalized: "${normalizedEmail}"`);

    // Step 1: Supabaseキャッシュ検索
    const { data: cached, error: cacheErr } = await supabase
      .from('futureshop_members')
      .select('member_id, last_name, first_name, email')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (cacheErr) {
      console.error('[member-check] Cache lookup error:', cacheErr);
    }

    if (cached) {
      console.log(`[member-check] Cache hit for ${normalizedEmail}`);
      const memberName = `${cached.last_name ?? ''} ${cached.first_name ?? ''}`.trim();
      return NextResponse.json({
        exists: true,
        memberId: cached.member_id,
        memberName,
        source: 'cache',
      });
    }

    // Step 2: APIフォールバック
    const { data: syncStatus, error: syncErr } = await supabase
      .from('sync_status')
      .select('last_synced_at')
      .eq('sync_key', 'futureshop_members')
      .maybeSingle();

    if (syncErr) {
      console.error('[member-check] sync_status lookup error:', syncErr);
    }

    const lastSyncedAt = syncStatus?.last_synced_at ?? null;
    console.log(`[member-check] Cache miss, falling back to API (since: ${lastSyncedAt ?? 'none'})`);

    const result = await fetchMembersWithFallback({
      email: normalizedEmail,
      updateDateStart: lastSyncedAt ?? undefined,
      maxPages: 20,
      pageSize: 100,
      timeoutMs: 25000,
    });

    console.log(
      `[member-check] API fallback finished - pagesFetched=${result.pagesFetched}, scanned=${result.totalScanned}, timedOut=${result.timedOut}, pagesLimitReached=${result.pagesLimitReached}`
    );

    if (result.found) {
      const m = result.found;
      const memberName = `${m.lastName} ${m.firstName}`.trim();
      console.log(`[member-check] Found via API: ${memberName} (${m.memberId})`);

      // 発見した会員をキャッシュに追加
      const { error: insertErr } = await supabase.from('futureshop_members').insert({
        member_id: m.memberId,
        email: normalizedEmail,
        last_name: m.lastName,
        first_name: m.firstName,
        cached_at: new Date().toISOString(),
      });
      if (insertErr) {
        console.error('[member-check] Cache insert error:', insertErr);
      } else {
        console.log(`[member-check] Cached new member: ${m.memberId}`);
      }

      return NextResponse.json({
        exists: true,
        memberId: m.memberId,
        memberName,
        source: 'api',
      });
    }

    console.log(`[member-check] Not found: ${normalizedEmail}`);
    return NextResponse.json({ exists: false });
  } catch (e) {
    console.error('[member-check] Error:', e);
    return NextResponse.json(
      { error: 'Futureshop API連携エラー' },
      { status: 500 }
    );
  }
}
