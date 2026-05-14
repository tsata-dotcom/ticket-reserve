import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import iconv from "iconv-lite";
import {
  getConfig,
  verifyCallbackHashcode,
  CALLBACK_HASH_FIELD_ORDER,
} from "@/lib/sbpayment";
import { sendQrEmail } from "@/lib/qr-mail";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

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

// パーセントエンコード文字列を生バイト列にデコードする。
// 例: "%8Ak%82%DE%82%AB" → Buffer<8a 6b 82 de 82 ab>（Shift-JIS バイト列）
// '+' は application/x-www-form-urlencoded の仕様により空白 (0x20) として扱う。
function percentDecodeToBuffer(str: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "%" && i + 2 < str.length) {
      const hi = str.charCodeAt(i + 1);
      const lo = str.charCodeAt(i + 2);
      const isHex = (c: number) =>
        (c >= 0x30 && c <= 0x39) ||
        (c >= 0x41 && c <= 0x46) ||
        (c >= 0x61 && c <= 0x66);
      if (isHex(hi) && isHex(lo)) {
        bytes.push(parseInt(str.substring(i + 1, i + 3), 16));
        i += 2;
        continue;
      }
    }
    if (ch === "+") {
      bytes.push(0x20);
    } else {
      bytes.push(str.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

// SBペイメントの結果CGI body は Shift-JIS バイト列を URL エンコードした形式
// （例: "item_name=%8Ak%82%DE%82%AB..."）。
// 通常の request.text() は body を UTF-8 として解釈するため日本語が文字化けし、
// その文字化け文字列を iconv.encode で Shift-JIS に戻しても元のバイト列とは
// 一致しない（= ハッシュ検証が通らない）。
// 正しい手順:
//   1. body をバイト列で読み出す (arrayBuffer)
//   2. ASCII として split（パーセントエンコード自体はASCII範囲なので安全）
//   3. 各値を percentDecodeToBuffer で Shift-JIS バイト列に戻す
//   4. iconv.decode(..., "Shift_JIS") で UTF-8 文字列化
//   5. verifyCallbackHashcode は内部で iconv.encode(value, "Shift_JIS") するので
//      元の Shift-JIS バイト列と一致する → ハッシュ検証OK
function parseSjisFormBody(buffer: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  const bodyAscii = buffer.toString("ascii");
  if (!bodyAscii) return out;
  for (const pair of bodyAscii.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq >= 0 ? pair.substring(0, eq) : pair;
    const rawValue = eq >= 0 ? pair.substring(eq + 1) : "";
    const keyBuf = percentDecodeToBuffer(rawKey);
    const valBuf = percentDecodeToBuffer(rawValue);
    // key 側は実運用上ほぼ ASCII だが念のため Shift-JIS デコードで統一する
    const key = iconv.decode(keyBuf, "Shift_JIS");
    const value = iconv.decode(valBuf, "Shift_JIS");
    out[key] = value;
  }
  return out;
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
  let params: Record<string, string> = {};
  try {
    const arrayBuffer = await request.arrayBuffer();
    params = parseSjisFormBody(Buffer.from(arrayBuffer));
  } catch (e) {
    console.error("[payment/callback] body parse error:", e);
    return plainResponse("NG,bad_request");
  }

  // SBペイメント公式仕様: 結果CGIのチェックサムは Shift-JIS で作成される。
  // verifyCallbackHashcode で Shift-JIS バイト連結 + SHA1 して検証。
  // ハッシュ不一致 / 不在の場合: SBペイメント仕様に従いレスポンスは "OK" を返すが、
  //   DB 更新はスキップしてリプレイ攻撃や偽のコールバックを防ぐ。
  // 試験環境などで検証が頻繁に失敗するケースに備え、SBPAYMENT_SKIP_HASH_VERIFY=true
  //   が設定されているときはハッシュ不一致でも処理を続行する（緊急バイパス）。
  const receivedHash = params["sps_hashcode"] ?? "";
  const { hashKey } = getConfig();
  const { sps_hashcode: _omit, ...rest } = params;
  void _omit;

  const skipHashVerify =
    (process.env.SBPAYMENT_SKIP_HASH_VERIFY ?? "").toLowerCase() === "true";

  let hashOk = true;
  if (!receivedHash) {
    console.error("[payment/callback] missing sps_hashcode", {
      order_id: params.order_id,
    });
    hashOk = false;
  } else if (
    !verifyCallbackHashcode(rest, CALLBACK_HASH_FIELD_ORDER, hashKey, receivedHash)
  ) {
    console.error("[payment/callback] hash mismatch", {
      order_id: params.order_id,
      received: receivedHash,
    });
    hashOk = false;
  }

  if (!hashOk && !skipHashVerify) {
    // SBペイメント側のリトライを止めるため OK は返しつつ、DB 更新は行わない。
    return plainResponse("OK");
  }
  if (!hashOk && skipHashVerify) {
    console.warn("[payment/callback] hash invalid but SBPAYMENT_SKIP_HASH_VERIFY=true (proceeding)");
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
  // cancel_policy_snapshot はQRメールに記載するキャンセルポリシー表のソース。
  const { data: reservation, error: fetchError } = await supabaseAdmin
    .from("reservations")
    .select(
      "id, order_no, buyer_email, buyer_name, tour_type, visit_date, time_slot, ticket_count, total_amount, qr_sent, cancel_policy_snapshot"
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
    //   authorized / captured / cancel_charged / auth_cancelled
    // のいずれかの自分以外の予約があれば「2回目以降」と判定。
    // - authorized: 未チェックインだがオーソリ済み（多重初回適用を防ぐ）
    // - captured: チェックイン済みで売上確定
    // - cancel_charged: キャンセル料請求済み
    // - auth_cancelled: 初回無料でチェックイン済み = 無料特典を使い切った
    let isFirstVisit = true;
    if (reservation.buyer_email && reservation.tour_type) {
      // reservations.tour_type は slug 統一済み（ステップ1）なので slug の eq で十分。
      const { data: prior, error: priorErr } = await supabaseAdmin
        .from("reservations")
        .select("id")
        .eq("buyer_email", reservation.buyer_email)
        .eq("tour_type", reservation.tour_type)
        .in("payment_status", [
          "authorized",
          "captured",
          "cancel_charged",
          "auth_cancelled",
        ])
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
    const { error: updateError } = await supabaseAdmin
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
        // tour_types は name と has_first_visit_free をまとめて取得。
        // tour_type には slug / 日本語 name が混在する可能性があるため or 検索で拾う。
        const { data: tourRow } = await supabase
          .from("tour_types")
          .select("slug, name, has_first_visit_free")
          .or(`slug.eq.${reservation.tour_type},name.eq.${reservation.tour_type}`)
          .maybeSingle();
        const tourRecord = tourRow as
          | { slug?: string; name?: string; has_first_visit_free?: boolean }
          | null;
        const tourName = tourRecord?.name ?? reservation.tour_type;

        // 初回無料適用フラグ:
        //   コースが has_first_visit_free=true で、かつこの予約が初回 (is_first_visit=true)。
        const isFirstVisitFree =
          isFirstVisit && tourRecord?.has_first_visit_free === true;

        await sendQrEmail({
          to: reservation.buyer_email,
          displayName: reservation.buyer_name ?? "",
          orderNo: reservation.order_no ?? reservationId,
          tourType: tourName,
          tourSlug: tourRecord?.slug ?? reservation.tour_type,
          visitDate: reservation.visit_date,
          timeSlot: reservation.time_slot,
          ticketCount: reservation.ticket_count,
          totalAmount: reservation.total_amount,
          isFirstVisitFree,
          cancelPolicy: reservation.cancel_policy_snapshot ?? null,
        });

        await supabaseAdmin
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
  const { error: failError } = await supabaseAdmin
    .from("reservations")
    .update({ payment_status: "failed", status: "payment_failed" })
    .eq("id", reservationId);

  if (failError) {
    console.error("[payment/callback] update failed status error:", failError);
  }

  return plainResponse("OK");
}
