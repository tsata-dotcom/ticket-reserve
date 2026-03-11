'use client';

import { useRouter } from 'next/navigation';
import { AuthProvider } from '@/lib/auth-context';
import Header from '@/components/Header';
import RegisterForm from '@/components/RegisterForm';

function RegisterPage() {
  const router = useRouter();

  return (
    <>
      <Header />
      <main className="max-w-[600px] mx-auto px-4 py-8">
        <RegisterForm
          onSuccess={() => router.push('/mypage')}
          onSwitchToLogin={() => router.push('/login')}
        />
      </main>
    </>
  );
}

export default function RegisterPageWrapper() {
  return (
    <AuthProvider>
      <RegisterPage />
    </AuthProvider>
  );
}
