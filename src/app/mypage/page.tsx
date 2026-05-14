'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { Reservation } from '@/lib/types';
import { findTourSlot, formatSlotWithTime, TourSlot } from '@/lib/tour-slots';
import Header from '@/components/Header';

// payment_messages テーブルの実カラムは message_key / message_text / description。
// title / body は誤りで、SELECT すると 400 になる。
type PaymentMessage = {
  message_key: string;
  message_text: string | null;
  description: string | null;
};

type CancelPreview = {
  fee: number;
  rate: number;
  freeCancel: boolean;
  tourAmount: number;
};

function applyPlaceholders(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_m, key) =>
    key in vars ? String(vars[key]) : `{${key}}`
  );
}

// 決済ステータスに対応する日本語ラベルと色クラス。
// pending / failed は /api/my-reservations の段階で除外されるためここでは扱わない。
function paymentStatusLabel(r: Reservation): string | null {
  const captured = (r.captured_amount ?? 0).toLocaleString();
  switch (r.payment_status) {
    case 'authorized':
      return '決済済み（チェックイン時にご請求）';
    case 'captured':
      return `お支払い済み ¥${captured}`;
    case 'auth_cancelled':
      return '初回無料（課金なし）';
    case 'cancel_charged':
      return `キャンセル料 ¥${captured} 請求済み`;
    case 'cancelled':
      return 'キャンセル済み（課金なし）';
    case 'refunded':
      return `返金済み ¥${captured}`;
    default:
      return null;
  }
}

function paymentStatusColor(status?: string | null): string {
  switch (status) {
    case 'authorized':
    case 'captured':
    case 'refunded':
      return 'text-green-700 font-bold';
    case 'cancel_charged':
      return 'text-orange-600 font-bold';
    case 'auth_cancelled':
    case 'cancelled':
    default:
      return 'text-gray-500';
  }
}

function PaymentInfoSection({ reservation }: { reservation: Reservation }) {
  const label = paymentStatusLabel(reservation);
  const policy = reservation.cancel_policy_snapshot;
  if (!label && !policy) return null;
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
      {label && (
        <p className={`text-xs ${paymentStatusColor(reservation.payment_status)}`}>
          {label}
        </p>
      )}
      {reservation.payment_status === 'authorized' && policy && (
        <p className="text-xs text-gray-500">
          キャンセル料: 2日前 {policy['2days'] ?? 0}% / 前日 {policy['1day'] ?? 0}% / 当日 {policy.today ?? 0}%
        </p>
      )}
    </div>
  );
}

function MyPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [tourNameMap, setTourNameMap] = useState<Record<string, string>>({});
  const [tourSlotsMap, setTourSlotsMap] = useState<Record<string, TourSlot[]>>({});
  const [paymentMessages, setPaymentMessages] = useState<Record<string, PaymentMessage>>({});
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<Reservation | null>(null);
  const [confirmPreview, setConfirmPreview] = useState<CancelPreview | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    const fetchAux = async () => {
      const [tours, msgs, slots] = await Promise.all([
        supabase.from('tour_types').select('slug, name'),
        supabase.from('payment_messages').select('message_key, message_text, description'),
        // tour_slots は公開読み取り可。reservations の tour_type は全て slug 統一済み
        // (ステップ1) なので、全有効スロットを一括取得して tour_slug ごとに分配する。
        supabase
          .from('tour_slots')
          .select('tour_slug, slot_key, label, time_label, display_order, is_active')
          .eq('is_active', true)
          .order('display_order', { ascending: true }),
      ]);
      if (tours.data) {
        const map: Record<string, string> = {};
        for (const t of tours.data) map[t.slug] = t.name;
        setTourNameMap(map);
      }
      if (msgs.data) {
        const map: Record<string, PaymentMessage> = {};
        for (const m of msgs.data as PaymentMessage[]) map[m.message_key] = m;
        setPaymentMessages(map);
      }
      if (slots.data) {
        const map: Record<string, TourSlot[]> = {};
        for (const s of slots.data as TourSlot[]) {
          (map[s.tour_slug] ??= []).push(s);
        }
        setTourSlotsMap(map);
      }
    };
    fetchAux();
  }, []);

  const tourLabel = (slug: string) => tourNameMap[slug] || slug;

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

  // キャンセルボタン押下: サーバーから現在のキャンセル料を取得して確認ダイアログを開く。
  const openCancelDialog = async (r: Reservation) => {
    setConfirmTarget(r);
    setConfirmPreview(null);
    setConfirmLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/payment/cancel?reservation_id=${r.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConfirmPreview(data as CancelPreview);
      }
    } catch (e) {
      console.error('cancel preview error:', e);
    } finally {
      setConfirmLoading(false);
    }
  };

  // ダイアログ「同意してキャンセルする」: /api/payment/cancel に POST。
  const confirmCancel = async () => {
    if (!confirmTarget) return;
    const id = confirmTarget.id;
    setCancellingId(id);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setCancellingId(null);
      return;
    }

    try {
      const res = await fetch('/api/payment/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ reservation_id: id }),
      });

      const data = await res.json();
      if (res.ok) {
        setReservations(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled' } : r));
        setToast(data.freeCancel ? 'キャンセルを受け付けました' : `キャンセル料 ¥${(data.fee ?? 0).toLocaleString()} を請求しました`);
        setTimeout(() => setToast(''), 4000);
      } else {
        setToast(data.error || 'キャンセルに失敗しました');
        setTimeout(() => setToast(''), 4000);
      }
    } catch (e) {
      console.error('cancel submit error:', e);
      setToast('キャンセル処理中にエラーが発生しました');
      setTimeout(() => setToast(''), 4000);
    } finally {
      setCancellingId(null);
      setConfirmTarget(null);
      setConfirmPreview(null);
    }
  };

  const renderedConfirmBody = useMemo(() => {
    if (!confirmTarget || !confirmPreview) return '';
    const key = confirmPreview.freeCancel ? 'cancel_confirm_no_fee' : 'cancel_confirm_with_fee';
    const msg = paymentMessages[key];
    if (!msg?.message_text) return '';
    const dateObj = new Date(confirmTarget.visit_date + 'T00:00:00');
    const dateLabel = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
    return applyPlaceholders(msg.message_text, {
      cancel_fee: confirmPreview.fee.toLocaleString(),
      rate: confirmPreview.rate,
      amount: confirmPreview.tourAmount.toLocaleString(),
      buyer_name: confirmTarget.buyer_name ?? '',
      visit_date: dateLabel,
      time_slot: findTourSlot(tourSlotsMap[confirmTarget.tour_type] ?? [], confirmTarget.time_slot).label,
    });
  }, [confirmTarget, confirmPreview, paymentMessages, tourSlotsMap]);

  const confirmTitle = useMemo(() => {
    if (!confirmPreview) return '';
    const key = confirmPreview.freeCancel ? 'cancel_confirm_no_fee' : 'cancel_confirm_with_fee';
    return paymentMessages[key]?.description || (confirmPreview.freeCancel ? 'キャンセルの確認' : 'キャンセル料のご確認');
  }, [confirmPreview, paymentMessages]);

  const handleResendQr = async (id: string) => {
    setResendingId(id);
    setToast('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const res = await fetch('/api/resend-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ reservation_id: id }),
      });

      if (res.ok) {
        setToast('QRコード付きメールを再送信しました');
        setTimeout(() => setToast(''), 4000);
      } else {
        const data = await res.json();
        setToast(data.error || 'メール再送信に失敗しました');
        setTimeout(() => setToast(''), 4000);
      }
    } catch {
      setToast('メール再送信に失敗しました');
      setTimeout(() => setToast(''), 4000);
    }
    setResendingId(null);
  };

  const today = new Date().toISOString().split('T')[0];
  const upcoming = reservations.filter(r => r.visit_date > today && r.status === 'reserved');
  const past = reservations.filter(r => r.visit_date <= today || r.status !== 'reserved');

  const timeSlotLabel = (slot: string, tourSlug: string) => {
    const info = findTourSlot(tourSlotsMap[tourSlug] ?? [], slot);
    return formatSlotWithTime(info.label, info.timeLabel);
  };

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

        {toast && (
          <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm font-bold text-center animate-fade-in">
            {toast}
          </div>
        )}

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
                        <p className="font-bold text-gray-800">{tourLabel(r.tour_type)}</p>
                        <p className="text-sm text-gray-500">{r.visit_date.replace(/-/g, '/')} {timeSlotLabel(r.time_slot, r.tour_type)}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-bold ${s.color}`}>{s.text}</span>
                    </div>
                    <div className="text-sm text-gray-500 mb-2">{r.ticket_count}名 / ¥{r.total_amount.toLocaleString()}</div>
                    <PaymentInfoSection reservation={r} />
                    <div className="flex items-center justify-between mt-3">
                      <button
                        onClick={() => handleResendQr(r.id)}
                        disabled={resendingId === r.id}
                        className="text-primary hover:text-primary-dark font-bold text-sm disabled:opacity-50"
                      >
                        {resendingId === r.id ? '送信中...' : 'QRメールを再送信'}
                      </button>
                      <button
                        onClick={() => openCancelDialog(r)}
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
                        <p className="font-bold text-gray-800">{tourLabel(r.tour_type)}</p>
                        <p className="text-sm text-gray-500">{r.visit_date.replace(/-/g, '/')} {timeSlotLabel(r.time_slot, r.tour_type)}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-bold ${s.color}`}>{s.text}</span>
                    </div>
                    <span className="text-sm text-gray-500">{r.ticket_count}名 / ¥{r.total_amount.toLocaleString()}</span>
                    <PaymentInfoSection reservation={r} />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* キャンセル確認ダイアログ */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            {confirmLoading || !confirmPreview ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold text-gray-800 mb-3">{confirmTitle}</h3>
                <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                  {renderedConfirmBody || (confirmPreview.freeCancel
                    ? 'この予約をキャンセルします。キャンセル料は発生しません。'
                    : `キャンセル料として ¥${confirmPreview.fee.toLocaleString()}（${confirmPreview.rate}%）が発生します。よろしいですか？`)}
                </p>
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => { setConfirmTarget(null); setConfirmPreview(null); }}
                    disabled={cancellingId === confirmTarget.id}
                    className="flex-1 py-2 border-2 border-gray-300 rounded-lg text-gray-600 font-bold hover:bg-gray-50"
                  >
                    戻る
                  </button>
                  <button
                    onClick={confirmCancel}
                    disabled={cancellingId === confirmTarget.id}
                    className="flex-1 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 disabled:opacity-50"
                  >
                    {cancellingId === confirmTarget.id ? '処理中...' : '同意してキャンセルする'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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
