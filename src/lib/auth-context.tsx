/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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

  const fetchProfile = async (userId: string): Promise<CustomerProfile | null> => {
    try {
      const { data, error } = await withTimeout(
        supabase.from('customer_profiles').select('*').eq('id', userId).single(),
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

  const upsertProfile = async (userId: string, name: string, email: string, phone: string): Promise<{ error: string | null }> => {
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('customer_profiles')
          .upsert({ id: userId, display_name: name, email, phone }, { onConflict: 'id' })
          .select()
          .single(),
        5000,
        TIMEOUT_FALLBACK as any
      );

      if (error) {
        console.error('upsertProfile error:', error);
        return { error: error.message };
      }
      if (data) setProfile(data);
      return { error: null };
    } catch (e) {
      console.error('upsertProfile unexpected error:', e);
      return { error: e instanceof Error ? e.message : 'プロフィールの作成に失敗しました' };
    }
  };

  const lookupFutureshopMember = async (email: string): Promise<void> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`/api/futureshop/member-search?email=${encodeURIComponent(email)}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        const { member } = await res.json();
        setFutureshopMember(member);
        console.log('[Futureshop] 会員連携成功:', member.memberId);

        // customer_profilesにfutureshop_member_idを保存
        const { data: { user: currentUser } } = await supabase.auth.getUser(session.access_token);
        if (currentUser) {
          const fullName = `${member.lastName} ${member.firstName}`.trim();
          await supabase
            .from('customer_profiles')
            .update({
              futureshop_member_id: member.memberId,
              ...(fullName ? { display_name: fullName } : {}),
              ...(member.telNoMain ? { phone: member.telNoMain } : {}),
            })
            .eq('id', currentUser.id);

          // プロフィールを再取得して最新状態を反映
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
      // 1. Futureshop会員チェック
      const checkRes = await fetch('/api/futureshop/member-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!checkRes.ok) {
        return { success: false, error: 'Futureshop会員確認に失敗しました。しばらく経ってから再度お試しください。' };
      }

      const checkData = await checkRes.json();

      if (!checkData.exists) {
        return { success: false, notFsMember: true };
      }

      // 2. OTPコード送信（emailRedirectToを指定しない → コード入力方式）
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
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error) {
        console.error('verifyOtp error:', error);
        if (error.message.includes('expired')) {
          return { success: false, error: '認証コードの有効期限が切れました。再送信してください。' };
        }
        return { success: false, error: '認証コードが正しくありません。' };
      }

      if (data.user) {
        setUser(data.user);
        await handleUserLogin(data.user);
      }

      return { success: true };
    } catch (e) {
      console.error('verifyOtp error:', e);
      return { success: false, error: e instanceof Error ? e.message : '認証に失敗しました' };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error('signOut error:', e);
    }
    setUser(null);
    setProfile(null);
    setFutureshopMember(null);
    window.location.reload();
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
