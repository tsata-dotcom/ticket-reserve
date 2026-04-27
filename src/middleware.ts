import { NextRequest, NextResponse } from "next/server";

// SBペイメントは success_url / cancel_url / error_url に Form POST でリダイレクトしてくる。
// しかし Next.js App Router の page.tsx (React Server Component) は GET 専用で、
// POST が来ると 405 Method Not Allowed を返す。
// また page.tsx と route.ts を同じ path に共存させることは Next.js が許可しない
// （route.ts が page.tsx を上書きしてしまう）ため、ここでは middleware で
// POST を受け止め、body から order_id を抽出して同一 URL に GET 303 リダイレクトする。
//
// SBペイメントの POST body には res_result / res_tracking_id 等の結果情報が含まれるが、
// それらは結果CGI (/api/payment/callback) で別途受信して DB を更新済みなので、
// 画面側は order_id だけで DB 参照すれば十分。res_* の情報は使わない。
//
// 注: middleware は Edge runtime で動作し、iconv-lite は使えない。SBペイメントが
// 送ってくる body は Shift-JIS だが、order_id 等の ASCII フィールドだけ取れれば良いので
// UTF-8 デコード（標準）でも問題なく解析できる。日本語フィールドは文字化けするが未使用。

const PAYMENT_RESULT_PATHS = new Set<string>([
  "/payment/success",
  "/payment/cancel",
  "/payment/error",
]);

export async function middleware(request: NextRequest) {
  if (request.method !== "POST") {
    return NextResponse.next();
  }
  if (!PAYMENT_RESULT_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  let orderId = "";
  try {
    const text = await request.text();
    const params = new URLSearchParams(text);
    orderId =
      params.get("order_id") ??
      request.nextUrl.searchParams.get("order_id") ??
      "";
  } catch (e) {
    console.warn("[middleware] payment POST body parse error:", e);
  }

  const url = request.nextUrl.clone();
  if (orderId) {
    url.searchParams.set("order_id", orderId);
  }
  // 303 See Other: POST→GET の意味的に正しいリダイレクトコード。
  return NextResponse.redirect(url, 303);
}

export const config = {
  matcher: ["/payment/success", "/payment/cancel", "/payment/error"],
};
