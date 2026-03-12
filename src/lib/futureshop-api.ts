import { proxyRequest } from './proxy-client';

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

  const data = await proxyRequest({
    method: 'POST',
    url: `https://${getApiDomain()}/oauth/token`,
    headers: {
      'X-SHOP-KEY': getShopKey(),
      'Authorization': `Basic ${getBasicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

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

  console.log(`[Futureshop] Searching member by email: ${email}`);

  const data = await proxyRequest({
    method: 'GET',
    url: `https://${getApiDomain()}/admin-api/v1/members?mail=${encodeURIComponent(email)}`,
    headers: {
      'X-SHOP-KEY': getShopKey(),
      'Authorization': `Bearer ${token}`,
    },
  });

  console.log('[Futureshop] Member search response:', JSON.stringify(data));

  // APIレスポンスから会員情報を抽出
  if (data.members && data.members.length > 0) {
    const m = data.members[0];
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
    return {
      memberId: data.memberId || data.member_id,
      lastName: data.lastName || data.last_name || '',
      firstName: data.firstName || data.first_name || '',
      mail: data.mail || data.email || '',
      telNoMain: data.telNoMain || data.tel_no_main || '',
    };
  }

  return null;
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

  const data = await proxyRequest({
    method: 'GET',
    url: `https://${getApiDomain()}/admin-api/v1/orders?${query.toString()}`,
    headers: {
      'X-SHOP-KEY': getShopKey(),
      'Authorization': `Bearer ${token}`,
    },
  });

  return data;
}

// 型定義
export interface FutureshopMember {
  memberId: string;
  lastName: string;
  firstName: string;
  mail: string;
  telNoMain: string;
}
