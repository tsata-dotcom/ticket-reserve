'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider } from '@/lib/auth-context';
import Header from '@/components/Header';
import LoginForm from '@/components/LoginForm';
import RegisterForm from '@/components/RegisterForm';

function LoginPage() {
  const router = useRouter();
  const [showRegister, setShowRegister] = useState(false);

  return (
    <>
      <Header />
      <main className="max-w-[600px] mx-auto px-4 py-8">
        {showRegister ? (
          <RegisterForm
            onSuccess={() => router.push('/mypage')}
            onSwitchToLogin={() => setShowRegister(false)}
          />
        ) : (
          <LoginForm
            onSuccess={() => router.push('/mypage')}
            onSwitchToRegister={() => setShowRegister(true)}
          />
        )}
      </main>
    </>
  );
}

export default function LoginPageWrapper() {
  return (
    <AuthProvider>
      <LoginPage />
    </AuthProvider>
  );
}
