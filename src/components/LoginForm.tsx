'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';

interface LoginFormProps {
  onSuccess: () => void;
  onSwitchToRegister: () => void;
}

export default function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        onSuccess();
      }
    } catch {
      setError('ログインに失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-gray-800 mb-6 text-center">ログイン</h2>

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

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">パスワード</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
            placeholder="パスワード"
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
              ログイン中...
            </>
          ) : 'ログインして予約に進む'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          onClick={onSwitchToRegister}
          className="text-primary hover:underline font-bold"
        >
          はじめての方はこちら（会員登録）
        </button>
      </div>
    </div>
  );
}
