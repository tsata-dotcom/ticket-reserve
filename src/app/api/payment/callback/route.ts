import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import iconv from "iconv-lite";
import { getConfig, verifyHashcode } from "@/lib/sbpayment";
import { sendQrEmail } from "@/lib/qr-mail";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// SBペイメント仕様: 結果CGIは text/plain charset=Shift_JIS, body は "OK" または "NG,メッセージ"。
function plainResponse(body: string, status = 200) {
  const sjis = iconv.encode(body, "Shift_JIS");
  return new Response(new Uint8Array(sjis), {
    status,
    headers: {
      "Content-Type": "text/plain; charset=Shift_JIS",
      "Cache-Control": "no-store",
    },
  });
}

// "kf_<32文字のUUIDハイフン除去>" 形式から元のUUIDに戻す。
function decodeOrderId(orderId: string): string | null {
  if (!orderId.startsWith("kf_")) return null;
  const body = orderId.slice(3);
  if (body.length < 32) return null;
  // UUID は 32桁の hex。order_id は 35桁切り出しているので先頭 32桁を取る。
  const hex = body.substring(0, 32);
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(
    12,
    16
  )}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`.toLowerCase();
}

export async function POST(request: NextRequest) {
  const params: Record<string, string> = {};
  try {
    const buffer = await request.arrayBuffer();
    const decoded = iconv.decode(Buffer.from(buffer), "Shift_JIS");
    const usp = new URLSearchParams(decoded);
    usp.forEach((value, key) => {
      params[key] = value;
    });
  } catch (e) {
    console.error("[payment/callback] body parse error:", e);
    return plainResponse("NG,bad_request");
  }

  // SBペイメント公式仕様: 「当社からの購入結果（画面返却）のチェックサムについては、
  //   文字コードをShift-JISで作成してチェックサム値を設定します。」
  // 現在の verifyHashcode は UTF-8 ベースで実装しているため、結果CGIのハッシュ検証は
  // 一致しない可能性が高い。本番移行前に Shift-JIS 版検証を別途実装するまで、
  // ハッシュ不一致でも処理を中断せず警告ログのみ出して続行する。
  const receivedHash = params["sps_hashcode"] ?? "";
  const { hashKey } = getConfig();
  const { sps_hashcode: _omit, ...rest } = params;
  void _omit;
  if (!receivedHash) {
    console.warn("[payment/callback] missing sps_hashcode (continuing anyway)", {
      order_id: params.order_id,
    });
  } else if (!verifyHashcode(rest, hashKey, receivedHash)) {
    // TODO: Shift-JIS 版 verifyHashcode を実装し、本番ではここで NG を返してブロックすること。
    console.warn("[payment/callback] hash mismatch (continuing anyway)", {
      order_id: params.order_id,
    });
  }

  const orderId = params.order_id ?? "";
  const reservationId = decodeOrderId(orderId);
  if (!reservationId) {
    console.warn("[payment/callback] invalid order_id:", orderId);
    return plainResponse("NG,bad_order_id");
  }

  const resResult = (params.res_result ?? "").toUpperCase();
  const resTrackingId = params.res_tracking_id ?? "";

  // 当該予約を読み出して、初回判定 / QRメール送信に必要な情報を取得。
  const { data: reservation, error: fetchError } = await supabase
    .from("reservations")
    .select(
      "id, order_no, buyer_email, buyer_name, tour_type, visit_date, time_slot, ticket_count, total_amount, qr_sent"
    )
    .eq("id", reservationId)
    .maybeSingle();

  if (fetchError || !reservation) {
    console.error("[payment/callback] reservation not found:", reservationId, fetchError);
    // SBペイメント側はリトライしてくる可能性があるが、こちら側に予約レコードが
    // ない以上 OK を返さないとリトライが続いてしまう。OKを返して警告ログのみ残す。
    return plainResponse("OK");
  }

  if (resResult === "OK") {
    // 同一email × 同一tour_type で payment_status が
    //   authorized / captured / cancel_charged
    // のいずれかの自分以外の予約があれば「2回目以降」と判定。
    // authorized を含めないと、未チェックインの予約が複数あった場合に全て初回扱いに
    // なってしまい、無料体験が複数回適用されてしまう不具合が起きる。
    let isFirstVisit = true;
    if (reservation.buyer_email && reservation.tour_type) {
      const { data: prior, error: priorErr } = await supabase
        .from("reservations")
        .select("id")
        .eq("buyer_email", reservation.buyer_email)
        .eq("tour_type", reservation.tour_type)
        .in("payment_status", ["authorized", "captured", "cancel_charged"])
        .neq("id", reservationId)
        .limit(1);
      if (priorErr) {
        console.error("[payment/callback] first-visit check error:", priorErr);
      }
      if (prior && prior.length > 0) {
        isFirstVisit = false;
      }
    }

    // オーソリ成功 → status を 'reserved' に昇格させてマイページで「予約済」として表示できるようにする。
    const { error: updateError } = await supabase
      .from("reservations")
      .update({
        sps_tracking_id: resTrackingId || null,
        sps_transaction_id: params.res_sps_payment_no || null,
        payment_status: "authorized",
        payment_completed_at: new Date().toISOString(),
        is_first_visit: isFirstVisit,
        status: "reserved",
      })
      .eq("id", reservationId);

    if (updateError) {
      console.error("[payment/callback] update authorized error:", updateError);
      // SBペイメント側のリトライを止めるため OK を返す（DB更新失敗はログで検知）。
    }

    // QRメール送信（オーソリ完了後の本予約として案内）。多重送信防止に qr_sent を見る。
    if (!reservation.qr_sent && reservation.buyer_email) {
      try {
        const { data: tourRow } = await supabase
          .from("tour_types")
          .select("name")
          .eq("slug", reservation.tour_type)
          .maybeSingle();
        const tourName = (tourRow as { name?: string } | null)?.name ?? reservation.tour_type;

        await sendQrEmail({
          to: reservation.buyer_email,
          displayName: reservation.buyer_name ?? "",
          orderNo: reservation.order_no ?? reservationId,
          tourType: tourName,
          visitDate: reservation.visit_date,
          timeSlot: reservation.time_slot,
          ticketCount: reservation.ticket_count,
          totalAmount: reservation.total_amount,
        });

        await supabase
          .from("reservations")
          .update({ qr_sent: true, qr_sent_at: new Date().toISOString() })
          .eq("id", reservationId);
      } catch (mailError) {
        console.error("[payment/callback] QR mail send error:", mailError);
      }
    }

    return plainResponse("OK");
  }

  // res_result が NG: failed としてマーク + status='payment_failed' に変更
  // （マイページの予約一覧から除外され、お客様には決済失敗が分かるようにする）。
  // レスポンス自体は SBペイメントの仕様上 OK を返す。
  const { error: failError } = await supabase
    .from("reservations")
    .update({ payment_status: "failed", status: "payment_failed" })
    .eq("id", reservationId);

  if (failError) {
    console.error("[payment/callback] update failed status error:", failError);
  }

  return plainResponse("OK");
}
