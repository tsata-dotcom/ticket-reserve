import { createHash } from "crypto";
import { XMLParser } from "fast-xml-parser";
import iconv from "iconv-lite";

// SBペイメント（ソフトバンクペイメントサービス）連携ユーティリティ。
// リンク型購入要求 (A01-1) のフォームパラメータ生成と、API型 (XML over HTTPS Basic) の
// 売上要求 / 取消返金要求 / 決済結果参照要求を実装する。詳細仕様は
// docs/sbpayment-implementation-spec.md と SBペイメント仕様書を参照。

export type SbpaymentResponse = {
  result: "OK" | "NG";
  spsTransactionId?: string;
  trackingId?: string;
  processDate?: string;
  errCode?: string;
  status?: string;
  rawXml: string;
};

type SbpaymentConfig = {
  merchantId: string;
  serviceId: string;
  hashKey: string;
  basicAuthId: string;
  basicAuthPw: string;
  apiUrl: string;
  linkUrl: string;
};

export function getConfig(): SbpaymentConfig {
  return {
    merchantId: process.env.SBPAYMENT_MERCHANT_ID ?? "30132",
    serviceId: process.env.SBPAYMENT_SERVICE_ID ?? "104",
    hashKey:
      process.env.SBPAYMENT_HASH_KEY ??
      "a23c0ef05956b20f8013d73b978fd1e93dc95341",
    basicAuthId: process.env.SBPAYMENT_BASIC_AUTH_ID ?? "30132104",
    basicAuthPw:
      process.env.SBPAYMENT_BASIC_AUTH_PW ??
      "a23c0ef05956b20f8013d73b978fd1e93dc95341",
    apiUrl:
      process.env.SBPAYMENT_API_URL ??
      "https://stbfep.sps-system.com/api/xmlapi.do",
    linkUrl:
      process.env.SBPAYMENT_LINK_URL ??
      "https://stbfep.sps-system.com/f01/FepBuyInfoReceive.do",
  };
}

export function generateHashcode(values: string[], hashKey: string): string {
  const concatenated = values.join("") + hashKey;
  return createHash("sha1").update(concatenated, "utf8").digest("hex");
}

export function formatRequestDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

// ----- リンク型購入要求 (A01-1) のフォームパラメータ生成 -----

export type ReservationForPayment = {
  reservationId: string;
  email: string;
  tourTypeSlug: string;
  tourTypeName: string;
  amount: number; // 税込
  ticketCount: number;
};

export type LinkFormParams = {
  pay_method: string;
  merchant_id: string;
  service_id: string;
  cust_code: string;
  sps_cust_no: string;
  sps_payment_no: string;
  order_id: string;
  item_id: string;
  item_name: string;
  tax: string;
  amount: string;
  pay_type: string;
  service_type: string;
  terminal_type: string;
  success_url: string;
  cancel_url: string;
  error_url: string;
  pagecon_url: string;
  free1: string;
  free2: string;
  free3: string;
  free_csv: string;
  request_date: string;
  limit_second: string;
  sps_hashcode: string;
};

// ハッシュ計算に使うフィールド順序（都度課金 A01-1 要求項目定義順）。
// この順で連結したうえで末尾にハッシュキーをつけてSHA1を取る。
// 連結順序を一箇所で定義することで、ハッシュ値とデバッグログの不一致を防ぐ。
export const LINK_HASH_FIELD_ORDER: ReadonlyArray<keyof Omit<LinkFormParams, "sps_hashcode">> = [
  "pay_method",
  "merchant_id",
  "service_id",
  "cust_code",
  "sps_cust_no",
  "sps_payment_no",
  "order_id",
  "item_id",
  "item_name",
  "tax",
  "amount",
  "pay_type",
  "service_type",
  "terminal_type",
  "success_url",
  "cancel_url",
  "error_url",
  "pagecon_url",
  "free1",
  "free2",
  "free3",
  "free_csv",
  "request_date",
  "limit_second",
];

export function getLinkHashValues(
  params: Omit<LinkFormParams, "sps_hashcode">
): string[] {
  return LINK_HASH_FIELD_ORDER.map((k) => params[k] ?? "");
}

// SBペイメントの cust_code は 64 文字制限。'kanifactory_' プレフィクス + emailのSHA256先頭20文字で
// 32文字に収まる。同一顧客でも email さえ同じなら同じ cust_code になる。
function buildCustCode(email: string): string {
  const hash = createHash("sha256")
    .update(email.trim().toLowerCase(), "utf8")
    .digest("hex");
  return `kanifactory_${hash.substring(0, 20)}`;
}

// SBペイメントの order_id は 38 文字制限。'kanifactory_' (12文字) + UUID32文字 = 44文字で超過するため
// 'kf_' (3文字) + UUIDハイフン除去先頭35文字 = 38文字に収める。
function buildOrderId(reservationId: string): string {
  const stripped = reservationId.replace(/-/g, "");
  return `kf_${stripped.substring(0, 35)}`;
}

// item_name は本来 Shift-JIS → Base64 化して送信する仕様だが、現在は SBペイメント側のハッシュ
// 検証エラー切り分けのため一時的にASCII（tourTypeSlug）を使う運用。エンコーディング問題と
// ハッシュ計算ロジック問題を切り分け終わったら、Shift-JIS → Base64 化に戻すこと。
export function encodeItemName(name: string): string {
  const truncated = name.length > 40 ? name.substring(0, 40) : name;
  const sjisBytes = iconv.encode(truncated, "Shift_JIS");
  return sjisBytes.toString("base64");
}

export function buildLinkFormParams(
  reservation: ReservationForPayment,
  now: Date = new Date()
): LinkFormParams {
  const config = getConfig();
  const baseUrl =
    process.env.NEXT_PUBLIC_RESERVE_URL ?? "https://reserve.kanifactory.com";

  const order_id = buildOrderId(reservation.reservationId);

  const params = {
    pay_method: "credit",
    merchant_id: config.merchantId,
    service_id: config.serviceId,
    cust_code: buildCustCode(reservation.email),
    sps_cust_no: "",
    sps_payment_no: "",
    order_id,
    item_id: reservation.tourTypeSlug,
    // [DEBUG] 切り分け中: item_name を一時的に tourTypeSlug（ASCII）にして
    // 「ハッシュ計算ロジック自体は正しいか / 日本語エンコーディングだけが問題か」を切り分ける。
    // 切り分け完了後は encodeItemName(reservation.tourTypeName) に戻す。
    item_name: reservation.tourTypeSlug,
    tax: "0",
    amount: String(reservation.amount),
    pay_type: "0",
    service_type: "0",
    terminal_type: "0",
    success_url: `${baseUrl}/payment/success?order_id=${encodeURIComponent(order_id)}`,
    cancel_url: `${baseUrl}/payment/cancel?order_id=${encodeURIComponent(order_id)}`,
    error_url: `${baseUrl}/payment/error?order_id=${encodeURIComponent(order_id)}`,
    pagecon_url: `${baseUrl}/api/payment/callback`,
    free1: "",
    free2: "",
    free3: "",
    free_csv: "", // 未使用だがハッシュ計算と form 送信の両方に空文字で含める必要あり
    request_date: formatRequestDate(now),
    limit_second: "600",
  };

  // ハッシュ計算は params に格納された値（item_name はASCIIスラッグ／本番ではBase64）を
  // そのまま連結して SHA1 する。getLinkHashValues が連結順序の単一情報源。
  const hashValues = getLinkHashValues(params);
  const sps_hashcode = generateHashcode(hashValues, config.hashKey);

  return { ...params, sps_hashcode };
}

// 結果CGI (A02-1) のハッシュ検証。
// 受信パラメータから sps_hashcode 以外を抽出して仕様順に並べ、SHA1再計算して一致するか確認する。
export function verifyHashcode(
  params: Record<string, string>,
  hashKey: string,
  receivedHash: string
): boolean {
  // 結果CGI返却項目の標準順序（SBペイメント A02-1 仕様書）。
  // 受信側はこの順で連結したうえで末尾にハッシュキーをつけてSHA1を取る。
  const order = [
    "pay_method",
    "merchant_id",
    "service_id",
    "cust_code",
    "sps_cust_no",
    "sps_payment_no",
    "order_id",
    "item_id",
    "item_name",
    "tax",
    "amount",
    "pay_type",
    "service_type",
    "terminal_type",
    "free1",
    "free2",
    "free3",
    "free_csv",
    "res_pay_method_info",
    "res_process_date",
    "res_result",
    "res_sps_cust_no",
    "res_sps_payment_no",
    "res_payinfo_key",
    "res_payment_date",
    "res_tracking_id",
    "res_err_code",
    "res_date",
  ];

  const values = order.map((key) =>
    params[key] === undefined || params[key] === null ? "" : params[key]
  );
  const expected = generateHashcode(values, hashKey);
  return expected.toLowerCase() === receivedHash.toLowerCase();
}

// ----- API型 XMLリクエスト -----

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderTag(key: string, value: unknown): string {
  if (value === null || value === undefined) return `<${key}></${key}>`;
  if (typeof value === "object" && !Array.isArray(value)) {
    const inner = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => renderTag(k, v))
      .join("");
    return `<${key}>${inner}</${key}>`;
  }
  if (Array.isArray(value)) {
    return value.map((v) => renderTag(key, v)).join("");
  }
  const str = String(value);
  if (str === "") return `<${key}></${key}>`;
  return `<${key}>${escapeXml(str)}</${key}>`;
}

export function buildApiXml(
  requestId: string,
  params: Record<string, unknown>
): string {
  const body = Object.entries(params)
    .map(([k, v]) => renderTag(k, v))
    .join("");
  return (
    `<?xml version="1.0" encoding="Shift_JIS" ?>` +
    `<sps-api-request id="${requestId}">${body}</sps-api-request>`
  );
}

function decodeXmlBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.subarray(0, Math.min(bytes.length, 200))
  );
  const isShiftJis = /encoding\s*=\s*["']?(Shift_JIS|shift_jis|SJIS|sjis|x-sjis)/i.test(
    head
  );
  if (isShiftJis) {
    try {
      const decoded = new TextDecoder("shift_jis").decode(bytes);
      return decoded.replace(
        /encoding\s*=\s*["'][^"']+["']/i,
        'encoding="UTF-8"'
      );
    } catch {
      // fall through
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export function parseApiResponse(xml: string): SbpaymentResponse {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml);
  const root = parsed["sps-api-response"] ?? {};
  const result = (root.res_result ?? "NG") as "OK" | "NG";
  return {
    result,
    spsTransactionId: root.res_sps_transaction_id ?? undefined,
    trackingId: root.res_tracking_id ?? undefined,
    processDate: root.res_process_date ?? undefined,
    errCode: root.res_err_code ?? undefined,
    status: root.res_status ?? undefined,
    rawXml: xml,
  };
}

export async function sendApiRequest(
  requestId: string,
  params: Record<string, unknown>
): Promise<SbpaymentResponse> {
  const config = getConfig();
  const xml = buildApiXml(requestId, params);
  const credentials = Buffer.from(
    `${config.basicAuthId}:${config.basicAuthPw}`
  ).toString("base64");

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/xml",
    },
    body: xml,
  });

  const responseBuffer = await response.arrayBuffer();
  const responseXml = decodeXmlBuffer(responseBuffer);
  return parseApiResponse(responseXml);
}

function flattenForHash(params: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const value of Object.values(params)) {
    if (value === null || value === undefined) {
      out.push("");
    } else if (typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenForHash(value as Record<string, unknown>));
    } else if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === "object" && v !== null) {
          out.push(...flattenForHash(v as Record<string, unknown>));
        } else {
          out.push(v === null || v === undefined ? "" : String(v));
        }
      }
    } else {
      out.push(String(value));
    }
  }
  return out;
}

function withHashcode(
  params: Record<string, unknown>,
  hashKey: string
): Record<string, unknown> {
  const values = flattenForHash(params);
  const sps_hashcode = generateHashcode(values, hashKey);
  return { ...params, sps_hashcode };
}

// 売上要求 ST02-00201-101。tracking_id 指定で部分キャプチャ可能。
export async function capturePayment(
  trackingId: string,
  amount: number
): Promise<SbpaymentResponse> {
  const config = getConfig();
  const requestDate = formatRequestDate();
  const params: Record<string, unknown> = {
    merchant_id: config.merchantId,
    service_id: config.serviceId,
    tracking_id: trackingId,
    processing_datetime: requestDate,
    pay_option_manage: {
      amount: String(amount),
    },
    request_date: requestDate,
  };
  const finalParams = withHashcode(params, config.hashKey);
  return sendApiRequest("ST02-00201-101", finalParams);
}

// 取消返金要求 ST02-00303-101。オーソリ済みかつ未売上のものを取消（無料キャンセル時）。
export async function voidAuthorization(
  trackingId: string
): Promise<SbpaymentResponse> {
  const config = getConfig();
  const requestDate = formatRequestDate();
  const params: Record<string, unknown> = {
    merchant_id: config.merchantId,
    service_id: config.serviceId,
    tracking_id: trackingId,
    processing_datetime: requestDate,
    request_date: requestDate,
  };
  const finalParams = withHashcode(params, config.hashKey);
  return sendApiRequest("ST02-00303-101", finalParams);
}

// 決済結果参照要求 MG01-00101-101。管理画面・接続テスト用。
export async function queryPaymentStatus(
  trackingId: string
): Promise<SbpaymentResponse> {
  const config = getConfig();
  const requestDate = formatRequestDate();
  const params: Record<string, unknown> = {
    merchant_id: config.merchantId,
    service_id: config.serviceId,
    tracking_id: trackingId,
    request_date: requestDate,
  };
  const finalParams = withHashcode(params, config.hashKey);
  return sendApiRequest("MG01-00101-101", finalParams);
}
