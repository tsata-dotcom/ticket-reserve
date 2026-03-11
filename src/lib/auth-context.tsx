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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { data } = await supabase
        .from('customer_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      setProfile(data);
      return data;
    } catch {
      return null;
    }
  };

  const ensureProfile = async (userId: string, name: string, email: string, phone: string) => {
    try {
      const existing = await fetchProfile(userId);
      if (existing) return { error: null };

      const { error } = await supabase.from('customer_profiles').insert({
        user_id: userId,
        display_name: name,
        email,
        phone,
      });
      if (error) return { error: error.message };

      await fetchProfile(userId);
      return { error: null };
    } catch (e) {
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
          await fetchProfile(session.user.id);
        }
      } catch {
        // ignore init errors
      }
      setLoading(false);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: 'メールアドレスまたはパスワードが正しくありません' };

      if (data.user) {
        // プロフィールがなければ取得を試みる（メール確認後の初回ログイン等）
        await fetchProfile(data.user.id);
      }

      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'ログインに失敗しました' };
    }
  };

  const signUp = async (email: string, password: string, name: string, phone: string): Promise<AuthResult> => {
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          return { error: 'このメールアドレスは既に登録されています' };
        }
        return { error: error.message };
      }

      // メール確認が必要な場合: sessionがnull
      if (data.user && !data.session) {
        return { error: null, needsEmailConfirmation: true };
      }

      // メール確認不要（autoConfirm有効）: sessionあり
      if (data.user && data.session) {
        const profileResult = await ensureProfile(data.user.id, name, email, phone);
        if (profileResult.error) {
          return { error: profileResult.error };
        }
      }

      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : '会員登録に失敗しました' };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
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
