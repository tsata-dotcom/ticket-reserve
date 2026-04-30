import { createClient, SupabaseClient } from "@supabase/supabase-js";

// service_role key を使った Supabase クライアント。RLS をバイパスするため
// サーバー側のみで使用する。クライアント (ブラウザ) からは絶対に import しないこと。
// 認証チェック後の信頼できるサーバー処理（例: customer_profiles upsert）に限定する。
//
// 遅延初期化: モジュール import 時点では client を作らず、最初に
// supabaseAdmin.from(...) 等が呼ばれた時点で生成する。これにより
// SUPABASE_SERVICE_ROLE_KEY が未設定の環境（ビルド時など）でも
// このユーティリティを import しただけでは落ちない。

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "supabaseAdmin: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です"
    );
  }
  client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

// SupabaseClient のメソッドを呼ぶときに getClient() に委譲する Proxy。
// 既存コードの `supabaseAdmin.from(...)` 形式をそのまま動かせる。
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const target = getClient() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
});
