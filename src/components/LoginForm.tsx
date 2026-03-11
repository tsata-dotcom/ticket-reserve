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

    const result = await signIn(email, password);
    if (result.error) {
      setError('メールアドレスまたはパスワードが正しくありません');
    } else {
      onSuccess();
    }
    setLoading(false);
  };

  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-gray-800 mb-6 text-center">ログイン</h2>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
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
          className="w-full py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors disabled:opacity-50 min-h-[48px]"
        >
          {loading ? 'ログイン中...' : 'ログインして予約に進む'}
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
