'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import { AuthProvider } from '@/lib/auth-context';

function PaymentCancelContent() {
  return (
    <>
      <Header />
      <main className="max-w-[600px] mx-auto px-4 py-10">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 text-center">
          <p className="text-lg font-bold text-yellow-800 mb-2">決済がキャンセルされました</p>
          <p className="text-sm text-gray-700">
            予約は確定していません。再度ご予約いただくには、予約ページからやり直してください。
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

export default function PaymentCancelPage() {
  return (
    <AuthProvider>
      <Suspense fallback={null}>
        <PaymentCancelContent />
      </Suspense>
    </AuthProvider>
  );
}
