import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// verifyOtp と onAuthStateChange の競合（AbortError: Lock broken）を避けるため、
// navigator.locks ベースのロックを無効化する no-op を渡す
const noopLock = async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    lock: noopLock,
    storageKey: 'kanifactory-auth',
    flowType: 'implicit',
  },
});
