/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';
import { CustomerProfile } from './types';

interface AuthResult {
  error: string | null;
  needsEmailConfirmation?: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: CustomerProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, name: string, phone: string) => Promise<AuthResult>;
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
const AUTH_TIMEOUT_FALLBACK = { data: { user: null, session: null }, error: { message: 'timeout' } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string): Promise<CustomerProfile | null> => {
    try {
      const { data, error } = await withTimeout(
        supabase.from('customer_profiles').select('*').eq('user_id', userId).single(),
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
          .upsert({ user_id: userId, display_name: name, email, phone }, { onConflict: 'user_id' })
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
          // プロフィール取得（失敗しても続行）
          const existing = await fetchProfile(session.user.id);
          if (!existing) {
            const meta = session.user.user_metadata;
            await upsertProfile(
              session.user.id,
              meta?.display_name || session.user.email || '',
              session.user.email || '',
              meta?.phone || '',
            );
          }
        }
      } catch (e) {
        console.error('Auth init error:', e);
      }
      setLoading(false);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setProfile(null);
      }
      // onAuthStateChangeではプロフィール操作しない（signIn/signUpで処理するため競合を防ぐ）
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        10000,
        AUTH_TIMEOUT_FALLBACK as any
      );

      if (error) {
        console.error('signIn error:', error);
        if (error.message === 'timeout') {
          return { error: 'ログイン処理がタイムアウトしました。再度お試しください。' };
        }
        return { error: 'メールアドレスまたはパスワードが正しくありません' };
      }

      if (data.user) {
        // プロフィール取得・作成（失敗してもログインは成功）
        try {
          const existing = await fetchProfile(data.user.id);
          if (!existing) {
            const meta = data.user.user_metadata;
            const result = await upsertProfile(
              data.user.id,
              meta?.display_name || email,
              email,
              meta?.phone || '',
            );
            if (result.error) {
              console.error('signIn プロフィール作成エラー:', result.error);
            }
          }
        } catch (e) {
          console.error('signIn profile error:', e);
        }
      }

      return { error: null };
    } catch (e) {
      console.error('signIn unexpected error:', e);
      return { error: e instanceof Error ? e.message : 'ログインに失敗しました' };
    }
  };

  const signUp = async (email: string, password: string, name: string, phone: string): Promise<AuthResult> => {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name, phone } },
        }),
        10000,
        AUTH_TIMEOUT_FALLBACK as any
      );

      if (error) {
        console.error('signUp error:', error);
        if (error.message === 'timeout') {
          return { error: '登録処理がタイムアウトしました。再度お試しください。' };
        }
        if (error.message.includes('already registered') || error.message.includes('already been registered') || error.message.includes('User already registered')) {
          return { error: 'このメールアドレスは既に登録されています' };
        }
        return { error: '登録に失敗しました: ' + error.message };
      }

      if (!data.user) {
        return { error: '登録に失敗しました' };
      }

      console.log('signUp success:', { userId: data.user.id, hasSession: !!data.session });

      // メール確認が必要な場合
      if (!data.session) {
        return { error: null, needsEmailConfirmation: true };
      }

      // セッションありの場合: プロフィール作成（失敗しても登録は成功）
      try {
        const result = await upsertProfile(data.user.id, name, email, phone);
        if (result.error) {
          console.error('signUp プロフィール作成エラー:', result.error);
        }
      } catch (e) {
        console.error('signUp profile error:', e);
      }

      return { error: null };
    } catch (e) {
      console.error('signUp unexpected error:', e);
      return { error: e instanceof Error ? e.message : '会員登録に失敗しました' };
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
    window.location.reload();
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
