'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';

interface LoginFormProps {
  onSuccess: () => void;
  onSwitchToRegister: () => void;
}

export default function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const { signInWithMagicLink, user } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [notFsMember, setNotFsMember] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // マジックリンクからの復帰時: ユーザーが認証されたらonSuccess
  useEffect(() => {
    if (user) {
      onSuccess();
    }
  }, [user, onSuccess]);

  // 15秒タイムアウトで自動解除
  useEffect(() => {
    if (loading) {
      timeoutRef.current = setTimeout(() => {
        setLoading(false);
        setError('処理がタイムアウトしました。もう一度お試しください。');
      }, 15000);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotFsMember(false);
    setLoading(true);

    try {
      const result = await signInWithMagicLink(email);

      if (result.notFsMember) {
        setNotFsMember(true);
      } else if (result.error) {
        setError(result.error);
      } else if (result.needsEmailConfirmation) {
        setEmailSent(true);
      }
    } catch (e) {
      console.error('Login: unexpected error', e);
      setError('ログインに失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  };

  // メール送信済み画面
  if (emailSent) {
    return (
      <div className="animate-fade-in">
        <div className="max-w-md mx-auto text-center">
          <div className="p-6 bg-blue-50 rounded-xl mb-6">
            <div className="text-4xl mb-4">&#x2709;&#xFE0F;</div>
            <h2 className="text-lg font-bold text-gray-800 mb-3">ログインメールを送信しました</h2>
            <p className="text-gray-600 text-sm leading-relaxed">
              <span className="font-bold">{email}</span> 宛にログインリンクを送信しました。
              メール内のリンクをクリックしてログインしてください。
            </p>
          </div>
          <p className="text-gray-400 text-xs mb-4">
            メールが届かない場合は、迷惑メールフォルダをご確認ください。
          </p>
          <button
            onClick={() => { setEmailSent(false); setEmail(''); }}
            className="text-primary hover:underline font-bold text-sm"
          >
            別のメールアドレスで試す
          </button>
        </div>
      </div>
    );
  }

  // Futureshop未会員画面
  if (notFsMember) {
    return (
      <div className="animate-fade-in">
        <div className="max-w-md mx-auto text-center">
          <div className="p-6 bg-orange-50 border border-orange-200 rounded-xl mb-6">
            <div className="text-4xl mb-4">&#x1F6C8;</div>
            <h2 className="text-lg font-bold text-gray-800 mb-3">会員登録が必要です</h2>
            <p className="text-gray-600 text-sm leading-relaxed mb-4">
              ご予約にはかにファクトリーオンラインショップの会員登録が必要です。
              下記リンクから会員登録のうえ、再度お試しください。
            </p>
            <a
              href="https://kanifactory.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block w-full py-3 bg-orange-500 text-white rounded-xl font-bold text-lg hover:bg-orange-600 transition-colors min-h-[48px]"
            >
              会員登録はこちら
            </a>
          </div>
          <button
            onClick={() => { setNotFsMember(false); setEmail(''); }}
            className="text-primary hover:underline font-bold text-sm"
          >
            別のメールアドレスで試す
          </button>
        </div>
      </div>
    );
  }

  // メールアドレス入力フォーム
  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-gray-800 mb-2 text-center">メール認証</h2>
      <p className="text-gray-500 text-sm text-center mb-6">
        メールアドレスにログインリンクをお送りします
      </p>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-start justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              className="ml-2 text-red-400 hover:text-red-600 flex-shrink-0"
            >
              &times;
            </button>
          </div>
        )}

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">メールアドレス</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
            placeholder="example@email.com"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors disabled:opacity-50 min-h-[48px] flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              確認中...
            </>
          ) : 'ログインリンクを送信する'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          onClick={onSwitchToRegister}
          className="text-primary hover:underline font-bold"
        >
          はじめての方はこちら（会員登録について）
        </button>
      </div>
    </div>
  );
}
