'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { AuthProvider } from '@/lib/auth-context';

function PaymentErrorContent() {
  return (
    <>
      <Header />
      <main className="max-w-[600px] mx-auto px-4 py-10">
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center">
          <p className="text-lg font-bold text-red-700 mb-2">決済処理中にエラーが発生しました</p>
          <p className="text-sm text-gray-700">
            恐れ入りますが、再度お試しいただくか、お問い合わせフォームからご連絡ください。
          </p>
        </div>
        <div className="mt-6 text-center space-y-3">
          <Link
            href="/"
            className="inline-block py-3 px-8 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark"
          >
            予約ページへ戻る
          </Link>
          <div>
            <Link href="/mypage" className="text-primary underline text-sm">マイページへ</Link>
          </div>
        </div>
      </main>
    </>
  );
}

export default function PaymentErrorPage() {
  return (
    <AuthProvider>
      <Suspense fallback={null}>
        <PaymentErrorContent />
      </Suspense>
    </AuthProvider>
  );
}
