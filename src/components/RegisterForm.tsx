'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';

interface RegisterFormProps {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
}

export default function RegisterForm({ onSuccess, onSwitchToLogin }: RegisterFormProps) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailConfirmation, setEmailConfirmation] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 10秒タイムアウトで自動解除
  useEffect(() => {
    if (loading) {
      timeoutRef.current = setTimeout(() => {
        setLoading(false);
        setError('処理がタイムアウトしました。もう一度お試しください。');
      }, 10000);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setEmailConfirmation(false);
    setLoading(true);

    try {
      const name = `${lastName} ${firstName}`;
      console.log('Register: starting signUp for', email);

      const result = await signUp(email, password, name, phone);

      console.log('Register: signUp result', { error: result.error, needsEmailConfirmation: result.needsEmailConfirmation });

      if (result.error) {
        setError(result.error);
      } else if (result.needsEmailConfirmation) {
        setEmailConfirmation(true);
      } else {
        onSuccess();
      }
    } catch (e) {
      console.error('Register: unexpected error', e);
      setError('会員登録に失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  };

  if (emailConfirmation) {
    return (
      <div className="animate-fade-in">
        <div className="max-w-md mx-auto text-center">
          <div className="p-6 bg-blue-50 rounded-xl mb-6">
            <div className="text-4xl mb-4">&#x2709;&#xFE0F;</div>
            <h2 className="text-lg font-bold text-gray-800 mb-3">確認メールを送信しました</h2>
            <p className="text-gray-600 text-sm leading-relaxed">
              <span className="font-bold">{email}</span> 宛に確認メールを送信しました。
              メール内のリンクをクリックしてから、ログインしてください。
            </p>
          </div>
          <button
            onClick={onSwitchToLogin}
            className="w-full py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors min-h-[48px]"
          >
            ログイン画面へ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-gray-800 mb-6 text-center">会員登録</h2>

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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">姓</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              placeholder="山田"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">名</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              placeholder="太郎"
            />
          </div>
        </div>

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

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">電話番号</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
            placeholder="090-1234-5678"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">パスワード</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
            placeholder="6文字以上"
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
              登録中...
            </>
          ) : '会員登録する'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          onClick={onSwitchToLogin}
          className="text-primary hover:underline font-bold"
        >
          アカウントをお持ちの方はこちら（ログイン）
        </button>
      </div>
    </div>
  );
}
