'use client';

import Link from 'next/link';
import { AuthProvider } from '@/lib/auth-context';
import Header from '@/components/Header';

function TourSlugNotFoundContent() {
  return (
    <>
      <Header />
      <main className="max-w-[600px] md:max-w-[800px] mx-auto px-4 py-12">
        <div className="text-center">
          <h1 className="text-xl md:text-2xl font-bold text-gray-800 mb-4">
            このツアーは現在公開されていません
          </h1>
          <p className="text-sm text-gray-600 mb-8">
            ご指定のツアーは存在しないか、現在ご予約を受け付けておりません。
          </p>
          <Link
            href="/"
            className="inline-block bg-primary text-white rounded-lg px-6 py-3 font-bold hover:bg-primary-dark transition-colors min-h-[48px]"
          >
            ツアー一覧へ戻る
          </Link>
        </div>
      </main>
    </>
  );
}

export default function TourSlugNotFound() {
  return (
    <AuthProvider>
      <TourSlugNotFoundContent />
    </AuthProvider>
  );
}
