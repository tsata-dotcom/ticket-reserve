/* eslint-disable @typescript-eslint/no-explicit-any */
import { proxyRequest } from './proxy-client';

function unwrapProxyResponse(data: any): any {
  // プロキシが { status, headers, body } でラップしている場合はbodyを取り出す
  if (data && typeof data === 'object' && 'body' in data && 'status' in data) {
    return data.body;
  }
  return data;
}

// トークンキャッシュ
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

function getApiDomain(): string {
  return process.env.FUTURESHOP_API_DOMAIN!;
}

function getShopKey(): string {
  return process.env.FUTURESHOP_SHOP_KEY!;
}

function getBasicAuth(): string {
  const clientId = process.env.FUTURESHOP_CLIENT_ID!;
  const clientSecret = process.env.FUTURESHOP_CLIENT_SECRET!;
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

/**
 * OAuth認証でアクセストークンを取得（キャッシュ付き）
 */
export async function getAccessToken(): Promise<string> {
  // キャッシュが有効ならそのまま返す（5分前に期限切れとみなす）
  if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  console.log('[Futureshop] Requesting new access token...');

  const rawData = await proxyRequest({
    method: 'POST',
    url: `https://${getApiDomain()}/oauth/token`,
    headers: {
      'X-SHOP-KEY': getShopKey(),
      'Authorization': `Basic ${getBasicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = unwrapProxyResponse(rawData);

  if (!data.access_token) {
    console.error('[Futureshop] Token response:', data);
    throw new Error('Failed to obtain Futureshop access token');
  }

  cachedToken = data.access_token as string;
  // expires_in はデフォルト3600秒（1時間）
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  console.log('[Futureshop] Access token obtained successfully');
  return cachedToken!;
}

/**
 * 会員検索API - メールアドレスで会員を検索
 */
export async function searchMemberByEmail(email: string): Promise<FutureshopMember | null> {
  const token = await getAccessToken();

  const searchEmail = email.trim().toLowerCase();
  console.log(`[Futureshop] Searching member by email: "${searchEmail}" (original="${email}")`);

  // limit パラメータを大きく指定（本番で会員数が多い場合のページネーション対策）
  const requestUrl = `https://${getApiDomain()}/admin-api/v1/member?mail=${encodeURIComponent(searchEmail)}&limit=1000`;
  console.log(`[Futureshop] Request URL: ${requestUrl}`);

  const rawData = await proxyRequest({
    method: 'GET',
    url: requestUrl,
    headers: {
      'X-SHOP-KEY': getShopKey(),
      'Authorization': `Bearer ${token}`,
    },
  });
  const data = unwrapProxyResponse(rawData);

  console.log('[Futureshop] Raw proxy response type:', typeof rawData, 'keys:', rawData && typeof rawData === 'object' ? Object.keys(rawData) : 'n/a');
  console.log('[Futureshop] Unwrapped response top-level keys:', data && typeof data === 'object' ? Object.keys(data) : 'n/a');
  console.log('[Futureshop] Full unwrapped response:', JSON.stringify(data).slice(0, 5000));

  // APIレスポンスから会員情報を抽出（memberList が実際のキー）
  // APIがmailフィルターを無視して全件返す場合があるため、クライアント側でメール一致を確認
  const memberArray = data.memberList || data.members;
  console.log(`[Futureshop] memberArray source: ${data.memberList ? 'memberList' : data.members ? 'members' : 'none'}, length: ${memberArray?.length ?? 0}`);
  console.log(`[Futureshop] Pagination info - total: ${data.total ?? 'n/a'}, count: ${data.count ?? 'n/a'}, hasMore: ${data.hasMore ?? 'n/a'}, nextPageToken: ${data.nextPageToken ?? 'n/a'}`);

  if (memberArray && memberArray.length > 0) {
    // サンプルとして先頭5件のメールアドレスを出力
    const sampleMails = memberArray.slice(0, 5).map((item: any) => item.mail || item.email);
    console.log(`[Futureshop] Sample mails (first 5): ${JSON.stringify(sampleMails)}`);

    console.log(`[Futureshop] Filtering ${memberArray.length} members against "${searchEmail}"...`);
    const m = memberArray.find((item: any) => {
      const itemMail = String(item.mail || item.email || '').trim().toLowerCase();
      return itemMail === searchEmail;
    }) || null;
    console.log(`[Futureshop] Filter result: ${m ? `matched memberId=${m.memberId || m.member_id}` : 'no match'}`);

    if (!m) return null;
    return {
      memberId: m.memberId || m.member_id,
      lastName: m.lastName || m.last_name || '',
      firstName: m.firstName || m.first_name || '',
      mail: m.mail || m.email || '',
      telNoMain: m.telNoMain || m.tel_no_main || '',
    };
  }

  // 単一会員レスポンスの場合
  if (data.memberId || data.member_id) {
    console.log('[Futureshop] Single-member response detected');
    return {
      memberId: data.memberId || data.member_id,
      lastName: data.lastName || data.last_name || '',
      firstName: data.firstName || data.first_name || '',
      mail: data.mail || data.email || '',
      telNoMain: data.telNoMain || data.tel_no_main || '',
    };
  }

  console.log('[Futureshop] No member data in response');
  return null;
}

/**
 * ページネーション付きで会員一覧を取得し、メールでフィルタリング
 * - updateDateStart があれば差分取得（新規登録 + 更新）、なければ全件
 * - maxPages または timeoutMs に達したら打ち切り
 */
export async function fetchMembersWithFallback(params: {
  email: string;
  updateDateStart?: string;
  maxPages?: number;
  pageSize?: number;
  timeoutMs?: number;
}): Promise<{
  found: FutureshopMember | null;
  pagesFetched: number;
  totalScanned: number;
  timedOut: boolean;
  pagesLimitReached: boolean;
}> {
  const maxPages = params.maxPages ?? 20;
  const pageSize = params.pageSize ?? 100;
  const timeoutMs = params.timeoutMs ?? 25000;
  const searchEmail = params.email.trim().toLowerCase();
  const startedAt = Date.now();

  const token = await getAccessToken();

  let offset = 0;
  let pagesFetched = 0;
  let totalScanned = 0;
  let timedOut = false;
  let pagesLimitReached = false;
  let found: FutureshopMember | null = null;

  for (let page = 0; page < maxPages; page++) {
    if (Date.now() - startedAt > timeoutMs) {
      console.log(`[Futureshop] Timeout (${timeoutMs}ms) reached after ${pagesFetched} pages`);
      timedOut = true;
      break;
    }

    const queryParams = new URLSearchParams();
    queryParams.set('limit', String(pageSize));
    queryParams.set('offset', String(offset));
    if (params.updateDateStart) {
      queryParams.set('updateDateStart', params.updateDateStart);
    }

    const requestUrl = `https://${getApiDomain()}/admin-api/v1/member?${queryParams.toString()}`;
    console.log(`[Futureshop] Fetch page ${page + 1}/${maxPages}: ${requestUrl}`);

    const rawData = await proxyRequest({
      method: 'GET',
      url: requestUrl,
      headers: {
        'X-SHOP-KEY': getShopKey(),
        'Authorization': `Bearer ${token}`,
      },
    });
    const data = unwrapProxyResponse(rawData);

    const memberArray = data.memberList || data.members;
    const pageCount = memberArray?.length ?? 0;
    totalScanned += pageCount;
    pagesFetched++;

    console.log(`[Futureshop] Page ${page + 1}: got ${pageCount} members (total scanned: ${totalScanned})`);

    if (pageCount === 0) {
      break;
    }

    const m = memberArray.find((item: any) => {
      const itemMail = String(item.mail || item.email || '').trim().toLowerCase();
      return itemMail === searchEmail;
    });

    if (m) {
      found = {
        memberId: m.memberId || m.member_id,
        lastName: m.lastName || m.last_name || '',
        firstName: m.firstName || m.first_name || '',
        mail: m.mail || m.email || '',
        telNoMain: m.telNoMain || m.tel_no_main || '',
      };
      break;
    }

    if (pageCount < pageSize) {
      break;
    }

    offset += pageSize;
  }

  if (pagesFetched >= maxPages && !found) {
    pagesLimitReached = true;
  }

  return { found, pagesFetched, totalScanned, timedOut, pagesLimitReached };
}

/**
 * memberId で会員が Futureshop 上に存在するか確認
 * - 存在: true / 削除済み or 見つからない: false
 */
export async function verifyMemberExistsById(memberId: string): Promise<boolean> {
  const token = await getAccessToken();

  const requestUrl = `https://${getApiDomain()}/admin-api/v1/member?memberId=${encodeURIComponent(memberId)}`;
  console.log(`[Futureshop] Verify memberId: ${requestUrl}`);

  const rawData = await proxyRequest({
    method: 'GET',
    url: requestUrl,
    headers: {
      'X-SHOP-KEY': getShopKey(),
      'Authorization': `Bearer ${token}`,
    },
  });
  const data = unwrapProxyResponse(rawData);

  const memberArray = data.memberList || data.members;
  if (Array.isArray(memberArray)) {
    return memberArray.length > 0;
  }
  // 単一会員レスポンス形式のフォールバック
  return Boolean(data.memberId || data.member_id);
}

/**
 * 受注検索API（将来用）
 */
export async function searchOrders(params: { memberId?: string; orderDateFrom?: string; orderDateTo?: string }) {
  const token = await getAccessToken();

  const query = new URLSearchParams();
  if (params.memberId) query.set('memberId', params.memberId);
  if (params.orderDateFrom) query.set('orderDateFrom', params.orderDateFrom);
  if (params.orderDateTo) query.set('orderDateTo', params.orderDateTo);

  const rawData = await proxyRequest({
    method: 'GET',
    url: `https://${getApiDomain()}/admin-api/v1/orders?${query.toString()}`,
    headers: {
      'X-SHOP-KEY': getShopKey(),
      'Authorization': `Bearer ${token}`,
    },
  });

  return unwrapProxyResponse(rawData);
}

// 型定義
export interface FutureshopMember {
  memberId: string;
  lastName: string;
  firstName: string;
  mail: string;
  telNoMain: string;
}
