'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Reservation } from '@/lib/types';
import Header from '@/components/Header';

function MyPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const fetchReservations = async () => {
      if (!user) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/my-reservations', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      setReservations(data.reservations || []);
      setLoading(false);
    };
    if (user) fetchReservations();
  }, [user]);

  const handleCancel = async (id: string) => {
    if (!confirm('この予約をキャンセルしますか？キャンセル後、同じ日時で再予約が可能です。')) return;

    setCancellingId(id);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch('/api/cancel-reservation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ reservation_id: id }),
    });

    if (res.ok) {
      setReservations(prev =>
        prev.map(r => r.id === id ? { ...r, status: 'cancelled' } : r)
      );
      alert('予約をキャンセルしました。枠が空きましたので、再度ご予約いただけます。');
    }
    setCancellingId(null);
  };

  const today = new Date().toISOString().split('T')[0];
  const upcoming = reservations.filter(r => r.visit_date > today && r.status === 'reserved');
  const past = reservations.filter(r => r.visit_date <= today || r.status !== 'reserved');

  const timeSlotLabel = (slot: string) =>
    slot === 'morning' ? '午前の部（10:00〜11:30）' : '午後の部（14:00〜15:30）';

  const statusLabel = (status: string) => {
    switch (status) {
      case 'reserved': return { text: '予約済み', color: 'bg-green-100 text-green-700' };
      case 'cancelled': return { text: 'キャンセル', color: 'bg-red-100 text-red-600' };
      case 'checked_in': return { text: 'チェックイン済み', color: 'bg-blue-100 text-blue-700' };
      default: return { text: status, color: 'bg-gray-100 text-gray-600' };
    }
  };

  if (authLoading || loading) {
    return (
      <>
        <Header />
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="max-w-[600px] md:max-w-[800px] mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-gray-800 mb-6">マイページ</h1>

        {/* Upcoming reservations */}
        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-700 mb-3 flex items-center gap-2">
            📅 今後の予約
            {upcoming.length > 0 && (
              <span className="bg-primary text-white text-xs px-2 py-0.5 rounded-full">{upcoming.length}</span>
            )}
          </h2>
          {upcoming.length === 0 ? (
            <p className="text-gray-400 text-center py-8 bg-white rounded-xl border border-gray-200">今後の予約はありません</p>
          ) : (
            <div className="space-y-3">
              {upcoming.map(r => {
                const s = statusLabel(r.status);
                return (
                  <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-bold text-gray-800">{r.tour_type}</p>
                        <p className="text-sm text-gray-500">{r.visit_date.replace(/-/g, '/')} {timeSlotLabel(r.time_slot)}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-bold ${s.color}`}>{s.text}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">{r.ticket_count}名 / ¥{r.total_amount.toLocaleString()}</span>
                      <button
                        onClick={() => handleCancel(r.id)}
                        disabled={cancellingId === r.id}
                        className="text-red-500 hover:text-red-700 font-bold text-sm disabled:opacity-50"
                      >
                        {cancellingId === r.id ? 'キャンセル中...' : 'キャンセル'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Past reservations */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-3">📋 過去の予約</h2>
          {past.length === 0 ? (
            <p className="text-gray-400 text-center py-8 bg-white rounded-xl border border-gray-200">過去の予約はありません</p>
          ) : (
            <div className="space-y-3">
              {past.map(r => {
                const s = statusLabel(r.status);
                return (
                  <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4 opacity-70">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-bold text-gray-800">{r.tour_type}</p>
                        <p className="text-sm text-gray-500">{r.visit_date.replace(/-/g, '/')} {timeSlotLabel(r.time_slot)}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-bold ${s.color}`}>{s.text}</span>
                    </div>
                    <span className="text-sm text-gray-500">{r.ticket_count}名 / ¥{r.total_amount.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

export default function MyPage() {
  return (
    <AuthProvider>
      <MyPageContent />
    </AuthProvider>
  );
}
