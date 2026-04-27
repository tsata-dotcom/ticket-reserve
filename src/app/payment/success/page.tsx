'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import { supabase } from '@/lib/supabase';
import { AuthProvider } from '@/lib/auth-context';

type ReservationView = {
  id: string;
  order_no: string | null;
  visit_date: string;
  time_slot: 'AM' | 'PM';
  ticket_count: number;
  total_amount: number;
  authorized_amount: number | null;
  payment_status: string;
  is_first_visit: boolean | null;
  tour_type: string;
  cancel_policy_snapshot: { '2days'?: number; '1day'?: number; today?: number } | null;
};

type TourLite = { slug: string; name: string };

function decodeOrderId(orderId: string): string | null {
  if (!orderId.startsWith('kf_')) return null;
  const body = orderId.slice(3);
  if (body.length < 32) return null;
  const hex = body.substring(0, 32);
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`.toLowerCase();
}

function timeSlotLabel(slot: 'AM' | 'PM') {
  return slot === 'AM' ? '午前の部（10:00〜11:30）' : '午後の部（14:00〜15:30）';
}

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('order_id') ?? '';
  const [reservation, setReservation] = useState<ReservationView | null>(null);
  const [tourName, setTourName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [pollCount, setPollCount] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const reservationId = decodeOrderId(orderId);
    if (!reservationId) {
      setError('注文IDが不正です');
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async (attempt: number) => {
      const { data, error: fetchError } = await supabase
        .from('reservations')
        .select('id, order_no, visit_date, time_slot, ticket_count, total_amount, authorized_amount, payment_status, is_first_visit, tour_type, cancel_policy_snapshot')
        .eq('id', reservationId)
        .maybeSingle();

      if (cancelled) return;

      if (fetchError) {
        console.error('reservation fetch error:', fetchError);
        setError('予約情報の取得に失敗しました');
        setLoading(false);
        return;
      }
      if (!data) {
        setError('予約が見つかりません');
        setLoading(false);
        return;
      }

      setReservation(data as ReservationView);

      // 結果CGIが先に届く前提だが、ブラウザリダイレクトが先行することもあるため
      // payment_status が pending のうちは数回ポーリングする。
      if (data.payment_status === 'pending' && attempt < 6) {
        setPollCount(attempt + 1);
        timer = setTimeout(() => load(attempt + 1), 1500);
        return;
      }

      if (data.tour_type) {
        const { data: tourRow } = await supabase
          .from('tour_types')
          .select('slug, name')
          .eq('slug', data.tour_type)
          .maybeSingle();
        if (tourRow) setTourName((tourRow as TourLite).name);
      }
      setLoading(false);
    };

    load(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId]);

  if (loading) {
    return (
      <>
        <Header />
        <main className="max-w-[600px] mx-auto px-4 py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-gray-600">
            決済結果を確認しています…
            {pollCount > 0 && <span className="block text-xs text-gray-400 mt-1">（最終確認まで少々お待ちください）</span>}
          </p>
        </main>
      </>
    );
  }

  if (error || !reservation) {
    return (
      <>
        <Header />
        <main className="max-w-[600px] mx-auto px-4 py-12 text-center">
          <p className="text-red-600 font-bold mb-4">{error || '予約が見つかりません'}</p>
          <Link href="/mypage" className="text-primary underline">マイページへ</Link>
        </main>
      </>
    );
  }

  const status = reservation.payment_status;
  const dateObj = new Date(reservation.visit_date + 'T00:00:00');
  const dateLabel = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
  const amount = reservation.authorized_amount ?? reservation.total_amount;
  const policy = reservation.cancel_policy_snapshot ?? null;

  if (status === 'pending') {
    return (
      <>
        <Header />
        <main className="max-w-[600px] mx-auto px-4 py-10">
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 text-center">
            <p className="font-bold text-yellow-700 mb-2">決済結果を確認中です</p>
            <p className="text-sm text-gray-700">
              SBペイメントからの結果通知をまだ受信できていません。
              数分後にこのページを再読み込みするか、マイページからご確認ください。
            </p>
          </div>
          <div className="mt-6 text-center">
            <Link href="/mypage" className="text-primary underline">マイページへ</Link>
          </div>
        </main>
      </>
    );
  }

  if (status === 'failed') {
    return (
      <>
        <Header />
        <main className="max-w-[600px] mx-auto px-4 py-10">
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center">
            <p className="font-bold text-red-700 mb-2">決済が完了しませんでした</p>
            <p className="text-sm text-gray-700">恐れ入りますが、再度お試しください。</p>
          </div>
          <div className="mt-6 text-center">
            <Link href="/mypage" className="text-primary underline">マイページへ</Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="max-w-[600px] mx-auto px-4 py-8">
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center mb-6">
          <p className="text-lg font-bold text-green-700">✅ ご予約が完了しました</p>
          {reservation.order_no && (
            <p className="text-sm text-gray-600 mt-1">予約番号: {reservation.order_no}</p>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          {tourName && (
            <div className="flex justify-between border-b border-gray-100 pb-3">
              <span className="text-gray-500">体験名</span>
              <span className="font-bold">{tourName}</span>
            </div>
          )}
          <div className="flex justify-between border-b border-gray-100 pb-3">
            <span className="text-gray-500">日付</span>
            <span className="font-bold">{dateLabel}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-3">
            <span className="text-gray-500">時間帯</span>
            <span className="font-bold">{timeSlotLabel(reservation.time_slot)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-100 pb-3">
            <span className="text-gray-500">参加人数</span>
            <span className="font-bold">{reservation.ticket_count}名</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">オーソリ金額</span>
            <span className="font-bold">¥{amount.toLocaleString()}</span>
          </div>
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
          {reservation.is_first_visit === true ? (
            <p className="text-sm text-blue-800 font-bold">
              🎉 初回無料でご体験いただけます。ご来店時に課金は発生しません。
            </p>
          ) : (
            <p className="text-sm text-blue-800 font-bold">
              チェックイン時に ¥{amount.toLocaleString()} がご請求されます。
            </p>
          )}
        </div>

        {policy && (
          <div className="mt-6 border border-gray-200 rounded-xl p-4 bg-white">
            <h3 className="font-bold text-gray-800 mb-2 text-sm">キャンセルポリシー</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>2日前まで: 無料</li>
              <li>2日前: {policy['2days'] ?? 0}%</li>
              <li>前日: {policy['1day'] ?? 0}%</li>
              <li>当日: {policy.today ?? 0}%</li>
            </ul>
          </div>
        )}

        <div className="mt-8 text-center">
          <Link
            href="/mypage"
            className="inline-block py-3 px-8 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark"
          >
            マイページへ
          </Link>
        </div>
      </main>
    </>
  );
}

export default function PaymentSuccessPage() {
  return (
    <AuthProvider>
      <Suspense fallback={null}>
        <PaymentSuccessContent />
      </Suspense>
    </AuthProvider>
  );
}
