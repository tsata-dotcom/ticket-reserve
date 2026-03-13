'use client';

import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';

export default function Header() {
  const { user, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-[800px] mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl">🦀</span>
          <div>
            <span className="font-bold text-primary text-lg leading-tight block">かにファクトリー</span>
            <span className="text-xs text-gray-500 leading-tight block">体験予約</span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link
                href="/mypage"
                className="text-sm text-white bg-primary rounded-lg px-3 py-2 hover:bg-primary-dark transition-colors font-bold whitespace-nowrap"
              >
                マイページ
              </Link>
              <button
                onClick={signOut}
                className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-3 py-2 whitespace-nowrap"
              >
                ログアウト
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="text-sm bg-primary text-white rounded-lg px-4 py-2 hover:bg-primary-dark transition-colors font-bold"
            >
              ログイン
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
