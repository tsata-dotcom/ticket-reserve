import { NextRequest, NextResponse } from 'next/server';
import { searchMemberByEmail } from '@/lib/futureshop-api';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'emailが必要です' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    console.log(`[member-check] Input email: "${email}" (length=${email.length})`);
    console.log(`[member-check] Normalized email: "${normalizedEmail}" (length=${normalizedEmail.length})`);

    const member = await searchMemberByEmail(normalizedEmail);

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
