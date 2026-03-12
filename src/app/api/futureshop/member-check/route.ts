import { NextRequest, NextResponse } from 'next/server';
import { searchMemberByEmail } from '@/lib/futureshop-api';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'emailが必要です' }, { status: 400 });
    }

    console.log(`[member-check] Checking: ${email}`);

    const member = await searchMemberByEmail(email);

    if (member) {
      const memberName = `${member.lastName} ${member.firstName}`.trim();
      console.log(`[member-check] Found: ${memberName} (${member.memberId})`);
      return NextResponse.json({ exists: true, memberName });
    }

    console.log(`[member-check] Not found: ${email}`);
    return NextResponse.json({ exists: false });
  } catch (e) {
    console.error('[member-check] Error:', e);
    return NextResponse.json(
      { error: 'Futureshop API連携エラー' },
      { status: 500 }
    );
  }
}
