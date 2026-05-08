import { NextRequest, NextResponse } from "next/server";
import iconv from "iconv-lite";
import { buildLinkFormParams, getConfig } from "@/lib/sbpayment";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function readPayload(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await request.json();
  }
  // application/x-www-form-urlencoded（クライアントからの hidden form submit 用）
  const text = await request.text();
  const usp = new URLSearchParams(text);
  const out: Record<string, unknown> = {};
  usp.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const body = await readPayload(request);
    const {
      reservationId,
      email,
      tourTypeSlug,
      tourTypeName,
      amount,
      ticketCount,
    } = body ?? {};

    if (!reservationId || !email || !tourTypeSlug || !tourTypeName || !amount) {
      return NextResponse.json(
        { error: "必要な項目が不足しています" },
        { status: 400 }
      );
    }

    const numericAmount = Math.floor(Number(amount));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return NextResponse.json(
        { error: "決済金額が不正です" },
        { status: 400 }
      );
    }

    const formParams = buildLinkFormParams({
      reservationId: String(reservationId),
      email: String(email),
      tourTypeSlug: String(tourTypeSlug),
      tourTypeName: String(tourTypeName),
      amount: numericAmount,
      ticketCount: Number(ticketCount) || 1,
    });

    const { error: updateError } = await supabaseAdmin
      .from("reservations")
      .update({
        payment_status: "pending",
        authorized_amount: numericAmount,
      })
      .eq("id", reservationId);

    if (updateError) {
      console.error("[payment/initiate] reservation update error:", updateError);
      return NextResponse.json(
        { error: "予約の更新に失敗しました" },
        { status: 500 }
      );
    }

    const { linkUrl } = getConfig();
    const inputs = Object.entries(formParams)
      .map(
        ([key, value]) =>
          `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(value))}" />`
      )
      .join("\n      ");

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="Shift_JIS" />
  <title>決済画面に遷移中…</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif; padding: 40px; text-align: center; color: #333; }
    .spinner { display: inline-block; width: 32px; height: 32px; border: 3px solid #ddd; border-top-color: #1a6985; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <p>決済画面に遷移中です…</p>
  <p style="font-size:12px;color:#888;">画面が切り替わらない場合は、下記ボタンを押してください。</p>
  <form id="sbpayment-form" method="POST" action="${escapeHtml(linkUrl)}" accept-charset="Shift_JIS">
      ${inputs}
      <noscript>
        <button type="submit">決済画面へ進む</button>
      </noscript>
  </form>
  <script>
    (function () {
      var f = document.getElementById('sbpayment-form');
      if (f) { f.submit(); }
    })();
  </script>
</body>
</html>`;

    // SBペイメント仕様: リンク型はShift-JISで受信する必要があるため、HTML本文を
    // Shift-JISのバイナリとして返す。ブラウザは Content-Type の charset と meta charset を
    // Shift_JIS と解釈し、accept-charset="Shift_JIS" の form 送信時もShift-JISで POST する。
    // Buffer をそのまま Response に渡すと一部ランタイムで再エンコードされる懸念があるため、
    // 明示的に ArrayBuffer (= 純粋なバイト列) に切り出して渡す。
    const sjisBuffer = iconv.encode(html, "Shift_JIS");
    const sjisBytes = sjisBuffer.buffer.slice(
      sjisBuffer.byteOffset,
      sjisBuffer.byteOffset + sjisBuffer.byteLength
    ) as ArrayBuffer;

    return new Response(sjisBytes, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=Shift_JIS",
        "Content-Length": String(sjisBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[payment/initiate] unexpected error:", error);
    return NextResponse.json(
      { error: "決済開始処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
