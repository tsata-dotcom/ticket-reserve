import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateCancelFee, CancelPolicySnapshot } from "@/lib/cancel-policy";
import { capturePayment, voidAuthorization } from "@/lib/sbpayment";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }

  const body = await request.json();
  const reservationId: string | undefined = body?.reservation_id;
  if (!reservationId) {
    return NextResponse.json({ error: "予約IDが必要です" }, { status: 400 });
  }

  const { data: reservation } = await supabaseAdmin
    .from("reservations")
    .select(
      "id, customer_id, status, payment_status, total_amount, authorized_amount, sps_tracking_id, visit_date, cancel_policy_snapshot"
    )
    .eq("id", reservationId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (!reservation) {
    return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  }

  if (reservation.status === "cancelled") {
    return NextResponse.json({ error: "既にキャンセル済みです" }, { status: 400 });
  }

  const today = new Date().toISOString().split("T")[0];
  if (reservation.visit_date < today) {
    return NextResponse.json({ error: "過去の予約はキャンセルできません" }, { status: 400 });
  }

  // サーバー側でキャンセル料を再計算（クライアント値は信用しない）。
  const tourAmount = Number(reservation.authorized_amount ?? reservation.total_amount ?? 0);
  const policy: CancelPolicySnapshot =
    (reservation.cancel_policy_snapshot as CancelPolicySnapshot | null) ?? {
      "2days": 0,
      "1day": 0,
      today: 0,
    };
  const { fee, rate, freeCancel } = calculateCancelFee(
    reservation.visit_date,
    new Date(),
    tourAmount,
    policy
  );

  const trackingId = reservation.sps_tracking_id as string | null;

  // payment_status が authorized でない（無料コース・未決済等）の場合は SBペイメント呼び出しをスキップ。
  const needsSbCall =
    !!trackingId && reservation.payment_status === "authorized";

  let nextPaymentStatus: string = reservation.payment_status ?? "free";
  let capturedAmount: number = 0;

  if (needsSbCall) {
    if (freeCancel) {
      const resp = await voidAuthorization(trackingId);
      if (resp.result !== "OK") {
        console.error("[payment/cancel] void failed:", resp);
        return NextResponse.json(
          { error: "オーソリ取消に失敗しました", detail: resp.errCode },
          { status: 502 }
        );
      }
      nextPaymentStatus = "cancelled";
    } else {
      const resp = await capturePayment(trackingId, fee);
      if (resp.result !== "OK") {
        console.error("[payment/cancel] capture failed:", resp);
        return NextResponse.json(
          { error: "キャンセル料の請求に失敗しました", detail: resp.errCode },
          { status: 502 }
        );
      }
      nextPaymentStatus = "cancel_charged";
      capturedAmount = fee;
    }
  } else {
    // 決済情報なし（無料コース等）
    nextPaymentStatus = freeCancel ? "cancelled" : "cancel_charged";
    capturedAmount = freeCancel ? 0 : fee;
  }

  const { error: updateError } = await supabaseAdmin
    .from("reservations")
    .update({
      status: "cancelled",
      payment_status: nextPaymentStatus,
      captured_amount: capturedAmount,
    })
    .eq("id", reservationId);

  if (updateError) {
    console.error("[payment/cancel] update error:", updateError);
    return NextResponse.json({ error: "予約の更新に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    fee,
    rate,
    freeCancel,
    paymentStatus: nextPaymentStatus,
  });
}

// 確認ダイアログ向けにキャンセル料を計算して返す（GETでプレビュー）。
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const reservationId = searchParams.get("reservation_id");
  if (!reservationId) {
    return NextResponse.json({ error: "予約IDが必要です" }, { status: 400 });
  }

  const { data: reservation } = await supabaseAdmin
    .from("reservations")
    .select(
      "id, customer_id, total_amount, authorized_amount, visit_date, cancel_policy_snapshot"
    )
    .eq("id", reservationId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (!reservation) {
    return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  }

  const tourAmount = Number(reservation.authorized_amount ?? reservation.total_amount ?? 0);
  const policy: CancelPolicySnapshot =
    (reservation.cancel_policy_snapshot as CancelPolicySnapshot | null) ?? {
      "2days": 0,
      "1day": 0,
      today: 0,
    };

  const result = calculateCancelFee(
    reservation.visit_date,
    new Date(),
    tourAmount,
    policy
  );

  return NextResponse.json({ ...result, tourAmount });
}
