import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

// 新規会員登録直後・Futureshop 連携時などに customer_profiles を upsert するための
// エンドポイント。クライアントから直接 .upsert() すると anon key で発行され
// RLS (42501) で弾かれるため、Bearer トークンで認証ユーザーを確認したうえで
// service_role key を持つ supabaseAdmin で upsert する。
// id は必ず認証ユーザー自身に固定するため、他人のプロフィールに干渉できない。

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// クライアントが渡せるカラムのホワイトリスト。これ以外は無視する。
const ALLOWED_FIELDS = [
  "display_name",
  "email",
  "phone",
  "futureshop_member_id",
] as const;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // body 無し: 自分の最低限のレコードを email だけで作る
  }

  const payload: Record<string, unknown> = { id: user.id };
  for (const key of ALLOWED_FIELDS) {
    if (body[key] === undefined || body[key] === null) continue;
    const value = body[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      payload[key] = trimmed === "" ? null : trimmed;
    } else {
      payload[key] = value;
    }
  }
  if (payload.email === undefined) {
    payload.email = user.email ?? "";
  }

  const { data, error } = await supabaseAdmin
    .from("customer_profiles")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    console.error("[customer-profile/upsert] error:", error);
    return NextResponse.json(
      { error: `プロフィール保存に失敗しました: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ profile: data });
}
