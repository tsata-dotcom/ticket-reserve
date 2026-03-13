'use client';

interface RegisterFormProps {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
}

export default function RegisterForm({ onSwitchToLogin }: RegisterFormProps) {
  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-gray-800 mb-6 text-center">会員登録について</h2>

      <div className="max-w-md mx-auto">
        <div className="p-6 bg-blue-50 border border-blue-200 rounded-xl mb-6">
          <p className="text-gray-700 text-sm leading-relaxed mb-4">
            ご予約には<span className="font-bold">かにファクトリーオンラインショップ</span>の会員登録が必要です。
          </p>
          <p className="text-gray-600 text-sm leading-relaxed mb-6">
            会員登録後、登録したメールアドレスでログインしてご予約いただけます。
          </p>
          <a
            href="https://cctest26120203.trial.future-shop.net/p/register"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors min-h-[48px] text-center"
          >
            オンラインショップで会員登録する
          </a>
        </div>

        <div className="text-center">
          <button
            onClick={onSwitchToLogin}
            className="text-primary hover:underline font-bold"
          >
            登録済みの方はこちら（ログイン）
          </button>
        </div>
      </div>
    </div>
  );
}
