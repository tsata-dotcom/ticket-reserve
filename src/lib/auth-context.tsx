/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';
import { CustomerProfile, FutureshopMemberInfo } from './types';

interface OtpResult {
  success: boolean;
  otpSent?: boolean;
  notFsMember?: boolean;
  error?: string;
}

interface VerifyResult {
  success: boolean;
  error?: string;
}

interface AuthContextType {
  user: User | null;
  profile: CustomerProfile | null;
  futureshopMember: FutureshopMemberInfo | null;
  loading: boolean;
  sendOtp: (email: string) => Promise<OtpResult>;
  verifyOtp: (email: string, token: string) => Promise<VerifyResult>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// タイムアウト付きPromise（PromiseLike対応）
function withTimeout<T>(promiseLike: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const TIMEOUT_FALLBACK = { data: null, error: { message: 'timeout' } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [futureshopMember, setFutureshopMember] = useState<FutureshopMemberInfo | null>(null);
  const [loading, setLoading] = useState(true);
  // verifyOtp 実行中は onAuthStateChange の処理をスキップして競合を避ける
  const isVerifyingRef = useRef(false);

  const fetchProfile = async (userId: string): Promise<CustomerProfile | null> => {
    try {
      const { data, error } = await withTimeout(
        // 新規ユーザーで profile 未作成の状態でも PGRST116 を投げないよう maybeSingle を使う。
        // データが無い場合は data=null が返ってくるだけで error は付かない。
        supabase.from('customer_profiles').select('*').eq('id', userId).maybeSingle(),
        5000,
        TIMEOUT_FALLBACK as any
      );
      if (error) {
        console.error('fetchProfile error:', error);
        return null;
      }
      setProfile(data);
      return data;
    } catch (e) {
      console.error('fetchProfile unexpected error:', e);
      return null;
    }
  };

  // customer_profiles への書き込みは RLS により anon key からは弾かれるため、
  // 全て /api/customer-profile/upsert（service_role）経由で行う。
  // userId 引数は受けるが、サーバー側で認証ユーザー自身に上書きされる。
  const upsertProfile = async (
    _userId: string,
    name: string,
    email: string,
    phone: string
  ): Promise<{ error: string | null }> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        return { error: 'セッションが切れました。再度ログインしてください。' };
      }
      const res = await fetch('/api/customer-profile/upsert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ display_name: name, email, phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('upsertProfile error:', data);
        return { error: data?.error || 'プロフィールの作成に失敗しました' };
      }
      if (data?.profile) setProfile(data.profile);
      return { error: null };
    } catch (e) {
      console.error('upsertProfile unexpected error:', e);
      return { error: e instanceof Error ? e.message : 'プロフィールの作成に失敗しました' };
    }
  };

  // Futureshop 連携時の customer_profiles 部分更新も同 API 経由で行う。
  const updateProfileViaApi = async (
    accessToken: string,
    fields: { display_name?: string; phone?: string; futureshop_member_id?: string }
  ): Promise<void> => {
    try {
      const res = await fetch('/api/customer-profile/upsert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error('[customer-profile] update via api failed:', data);
      }
    } catch (e) {
      console.error('[customer-profile] update via api error:', e);
    }
  };

  const lookupFutureshopMember = async (email: string): Promise<void> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const normalizedEmail = email.trim().toLowerCase();

      // Step 1: ローカルキャッシュ (futureshop_members) を優先参照する。
      // sendOtp → member-check の段階で paginated fetch 経由で確実にキャッシュされており、
      // /api/futureshop/member-search が使う single-page API より取りこぼしがない。
      const { data: cached, error: cacheErr } = await supabase
        .from('futureshop_members')
        .select('member_id, last_name, first_name, email')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (cacheErr) {
        console.error('[Futureshop] キャッシュ参照エラー:', cacheErr);
      }

      if (cached) {
        const member: FutureshopMemberInfo = {
          memberId: cached.member_id,
          lastName: cached.last_name ?? '',
          firstName: cached.first_name ?? '',
          mail: cached.email ?? normalizedEmail,
          telNoMain: '',
        };
        setFutureshopMember(member);
        console.log('[Futureshop] 会員連携成功（キャッシュ）:', member.memberId);

        const { data: { user: currentUser } } = await supabase.auth.getUser(session.access_token);
        if (currentUser) {
          const fullName = `${member.lastName} ${member.firstName}`.trim();
          await updateProfileViaApi(session.access_token, {
            futureshop_member_id: member.memberId,
            ...(fullName ? { display_name: fullName } : {}),
          });
          await fetchProfile(currentUser.id);
        }
        return;
      }

      // Step 2: キャッシュ未ヒット時のみ API フォールバック
      const res = await fetch(`/api/futureshop/member-search?email=${encodeURIComponent(email)}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        const { member } = await res.json();
        setFutureshopMember(member);
        console.log('[Futureshop] 会員連携成功（API）:', member.memberId);

        const { data: { user: currentUser } } = await supabase.auth.getUser(session.access_token);
        if (currentUser) {
          const fullName = `${member.lastName} ${member.firstName}`.trim();
          await updateProfileViaApi(session.access_token, {
            futureshop_member_id: member.memberId,
            ...(fullName ? { display_name: fullName } : {}),
            ...(member.telNoMain ? { phone: member.telNoMain } : {}),
          });
          await fetchProfile(currentUser.id);
        }
      } else {
        console.log('[Futureshop] 会員未登録（予約には影響なし）');
        setFutureshopMember(null);
      }
    } catch (e) {
      console.error('[Futureshop] 会員検索エラー:', e);
      setFutureshopMember(null);
    }
  };

  const handleUserLogin = async (loginUser: User) => {
    // プロフィール取得・作成
    try {
      const existing = await fetchProfile(loginUser.id);
      if (!existing) {
        const meta = loginUser.user_metadata;
        await upsertProfile(
          loginUser.id,
          meta?.display_name || loginUser.email || '',
          loginUser.email || '',
          meta?.phone || '',
        );
      }
    } catch (e) {
      console.error('handleUserLogin profile error:', e);
    }

    // Futureshop会員検索
    if (loginUser.email) {
      lookupFutureshopMember(loginUser.email);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser(session.user);
          await handleUserLogin(session.user);
        }
      } catch (e) {
        console.error('Auth init error:', e);
      }
      setLoading(false);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // verifyOtp 実行中はリスナーをスキップ（lock 競合の回避）
      if (isVerifyingRef.current) {
        return;
      }

      const prevUser = user;
      setUser(session?.user ?? null);

      if (!session?.user) {
        setProfile(null);
        setFutureshopMember(null);
        return;
      }

      // マジックリンクからのログイン時にプロフィール・FS連携を実行
      if (event === 'SIGNED_IN' && !prevUser && session.user) {
        await handleUserLogin(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const sendOtp = async (email: string): Promise<OtpResult> => {
    try {
      // 1. Futureshop会員チェック（必ずOTP送信より先に実行）
      console.log('[sendOtp] member-check開始:', email);
      const checkRes = await fetch('/api/futureshop/member-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      let checkData: { exists?: boolean; error?: string } | null = null;
      try {
        checkData = await checkRes.json();
      } catch (e) {
        console.error('[sendOtp] member-checkレスポンスJSONパース失敗:', e);
      }

      console.log('[sendOtp] member-check結果:', {
        status: checkRes.status,
        ok: checkRes.ok,
        data: checkData,
      });

      // member-check API自体のエラー（ステータスNG or レスポンス不正）
      if (!checkRes.ok || !checkData || typeof checkData.exists !== 'boolean') {
        return { success: false, error: 'Futureshop会員確認に失敗しました。しばらく経ってから再度お試しください。' };
      }

      // 会員が見つからない（exists: false）→ 会員登録案内へ
      if (checkData.exists === false) {
        console.log('[sendOtp] 未会員のためnotFsMemberを返却');
        return { success: false, notFsMember: true };
      }

      // 2. 会員確認OK → OTPコード送信（emailRedirectToを指定しない → コード入力方式）
      console.log('[sendOtp] 会員確認OK、OTP送信開始');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      });

      if (error) {
        console.error('sendOtp error:', error);
        if (error.message.includes('rate') || error.message.includes('limit')) {
          return { success: false, error: 'メール送信の制限に達しました。60秒後に再度お試しください。' };
        }
        return { success: false, error: 'メール送信に失敗しました。もう一度お試しください。' };
      }

      return { success: true, otpSent: true };
    } catch (e) {
      console.error('sendOtp error:', e);
      return { success: false, error: e instanceof Error ? e.message : 'ログインに失敗しました' };
    }
  };

  const verifyOtp = async (email: string, token: string): Promise<VerifyResult> => {
    isVerifyingRef.current = true;
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error) {
        console.error('verifyOtp error:', error.message);
        const msg = error.message.toLowerCase();
        if (msg.includes('expired')) {
          return { success: false, error: '認証コードの有効期限が切れました。再送信してください。' };
        }
        if (msg.includes('invalid') || msg.includes('token')) {
          return { success: false, error: '認証コードが正しくありません。再度ご確認ください。' };
        }
        return { success: false, error: '認証に失敗しました。もう一度お試しください。' };
      }

      if (data.user) {
        setUser(data.user);
        await handleUserLogin(data.user);
      }

      return { success: true };
    } catch (e) {
      console.error('verifyOtp error:', e);
      return { success: false, error: e instanceof Error ? e.message : '認証に失敗しました' };
    } finally {
      isVerifyingRef.current = false;
    }
  };

  const signOut = async () => {
    // stateを即座にクリア → ユーザーは即座にログアウト状態になる
    setUser(null);
    setProfile(null);
    setFutureshopMember(null);

    // signOutはバックグラウンドで非同期完了（awaitしない）
    supabase.auth.signOut().catch(console.error);
  };

  return (
    <AuthContext.Provider value={{ user, profile, futureshopMember, loading, sendOtp, verifyOtp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
