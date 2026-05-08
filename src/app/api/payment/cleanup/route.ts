import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

// SBペイメント決済画面で離脱したお客様の予約は status='pending_payment' の
// まま残り続ける。pending_payment は availability の枠カウントに含めない設計
// に変更したため運用上の致命傷ではないが、DBクリーンアップとして
// 一定時間経過後に 'expired' へ落とすバッチエンドポイントを用意する。
//
// Vercel Cron や外部スケジューラから定期的に POST する想定。
// Authorization: Bearer {PAYMENT_CLEANUP_SECRET} が必須。
// シークレット未設定 / 不一致は 401 を返す（誰でも叩けるエンドポイントにしない）。

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.PAYMENT_CLEANUP_SECRET;
  if (!expectedSecret) {
    console.error("[payment/cleanup] PAYMENT_CLEANUP_SECRET is not set");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const presented = authHeader.replace(/^Bearer\s+/i, "");
  if (!presented || presented !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("reservations")
    .update({ status: "expired", payment_status: "expired" })
    .eq("status", "pending_payment")
    .lt("created_at", oneHourAgo)
    .select("id");

  if (error) {
    console.error("[payment/cleanup] update error:", error);
    return NextResponse.json(
      { error: "クリーンアップ処理に失敗しました", detail: error.message },
      { status: 500 }
    );
  }

  const expired_count = data?.length ?? 0;
  return NextResponse.json({
    expired_count,
    message: `${expired_count} 件の pending_payment レコードを expired に更新しました`,
  });
}
