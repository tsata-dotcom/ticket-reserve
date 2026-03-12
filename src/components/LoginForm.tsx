'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';

interface LoginFormProps {
  onSuccess: () => void;
  onSwitchToRegister: () => void;
}

type FormState = 'email' | 'otp' | 'notFsMember';

export default function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const { sendOtp, verifyOtp, user } = useAuth();
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [formState, setFormState] = useState<FormState>('email');
  const [resending, setResending] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);

  // ユーザーが認証されたらonSuccess
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

  // OTP画面に切り替わったらinputにフォーカス
  useEffect(() => {
    if (formState === 'otp' && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [formState]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await sendOtp(email);

      if (result.notFsMember) {
        setFormState('notFsMember');
      } else if (result.error) {
        setError(result.error);
      } else if (result.otpSent) {
        setFormState('otp');
        setOtpCode('');
      }
    } catch (e) {
      console.error('Login: unexpected error', e);
      setError('ログインに失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await verifyOtp(email, otpCode);

      if (result.error) {
        setError(result.error);
      }
      // success の場合は useEffect の user 監視で onSuccess が呼ばれる
    } catch (e) {
      console.error('Verify: unexpected error', e);
      setError('認証に失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  };

  const handleResend = async () => {
    setError('');
    setResending(true);

    try {
      const result = await sendOtp(email);
      if (result.error) {
        setError(result.error);
      } else {
        setOtpCode('');
        setError('');
      }
    } catch (e) {
      console.error('Resend: unexpected error', e);
      setError('再送信に失敗しました。');
    } finally {
      setResending(false);
    }
  };

  // Futureshop未会員画面
  if (formState === 'notFsMember') {
    return (
      <div className="animate-fade-in">
        <div className="max-w-md mx-auto text-center">
          <div className="p-6 bg-orange-50 border border-orange-200 rounded-xl mb-6">
            <div className="text-4xl mb-4">&#x1F6C8;</div>
            <h2 className="text-lg font-bold text-gray-800 mb-3">会員登録が必要です</h2>
            <p className="text-gray-600 text-sm leading-relaxed mb-4">
              ご予約にはかにファクトリーオンラインショップの会員登録が必要です。
            </p>
            <a
              href="https://cctest26120203.trial.future-shop.net/p/register"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block w-full py-3 bg-orange-500 text-white rounded-xl font-bold text-lg hover:bg-orange-600 transition-colors min-h-[48px]"
            >
              オンラインショップで会員登録する
            </a>
            <p className="text-gray-500 text-xs mt-3">
              登録後、このページに戻ってメールアドレスを入力してください。
            </p>
          </div>
          <button
            onClick={() => { setFormState('email'); setEmail(''); setError(''); }}
            className="text-primary hover:underline font-bold text-sm"
          >
            別のメールアドレスで試す
          </button>
        </div>
      </div>
    );
  }

  // OTPコード入力画面
  if (formState === 'otp') {
    return (
      <div className="animate-fade-in">
        <div className="max-w-md mx-auto">
          <div className="p-6 bg-blue-50 rounded-xl mb-6 text-center">
            <div className="text-4xl mb-4">&#x2709;&#xFE0F;</div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">認証コードを送信しました</h2>
            <p className="text-gray-600 text-sm leading-relaxed">
              <span className="font-bold">{email}</span> 宛に認証コードを送信しました。
              メールに届いた6桁のコードを入力してください。
            </p>
          </div>

          <form onSubmit={handleVerifyOtp} className="space-y-4">
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
              <label className="block text-sm font-bold text-gray-700 mb-1">認証コード</label>
              <input
                ref={otpInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                required
                maxLength={6}
                className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none text-center text-2xl tracking-[0.5em] font-mono"
                placeholder="123456"
              />
            </div>

            <button
              type="submit"
              disabled={loading || otpCode.length < 6}
              className="w-full py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors disabled:opacity-50 min-h-[48px] flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  認証中...
                </>
              ) : 'ログイン'}
            </button>
          </form>

          <div className="mt-6 text-center space-y-3">
            <button
              onClick={handleResend}
              disabled={resending}
              className="text-primary hover:underline font-bold text-sm disabled:opacity-50"
            >
              {resending ? '送信中...' : 'コードを再送信する'}
            </button>
            <br />
            <button
              onClick={() => { setFormState('email'); setOtpCode(''); setError(''); }}
              className="text-gray-500 hover:underline text-sm"
            >
              メールアドレスを変更する
            </button>
          </div>

          <p className="text-gray-400 text-xs text-center mt-4">
            メールが届かない場合は、迷惑メールフォルダをご確認ください。
          </p>
        </div>
      </div>
    );
  }

  // メールアドレス入力フォーム
  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-gray-800 mb-2 text-center">メール認証</h2>
      <p className="text-gray-500 text-sm text-center mb-6">
        メールアドレスに認証コードをお送りします
      </p>

      <form onSubmit={handleSendOtp} className="space-y-4 max-w-md mx-auto">
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
          ) : '認証コードを送信する'}
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
