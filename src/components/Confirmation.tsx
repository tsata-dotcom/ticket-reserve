'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { SiteContent, TourUIRecord } from '@/lib/types';
import { supabase } from '@/lib/supabase';

interface ConfirmationProps {
  tour: TourUIRecord;
  selectedDate: string;
  timeSlot: 'AM' | 'PM';
  ticketCount: number;
  onBack: () => void;
  onComplete: (orderNo: string) => void;
}

export default function Confirmation({ tour, selectedDate, timeSlot, ticketCount, onBack, onComplete }: ConfirmationProps) {
  const { user, profile, futureshopMember } = useAuth();
  const [isFirstTime, setIsFirstTime] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [policy, setPolicy] = useState<SiteContent | null>(null);
  const [agreed, setAgreed] = useState(false);

  const isFutureshopLinked = !!futureshopMember || !!profile?.futureshop_member_id;

  // Futureshop連携済みの場合はFutureshop情報を優先表示
  const displayName = futureshopMember
    ? `${futureshopMember.lastName} ${futureshopMember.firstName}`.trim()
    : profile?.display_name || user?.user_metadata?.display_name || user?.email || '';
  const displayEmail = futureshopMember?.mail || profile?.email || user?.email || '';
  const displayPhone = futureshopMember?.telNoMain || profile?.phone || '';

  const dateObj = new Date(selectedDate + 'T00:00:00');
  const dateLabel = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
  const timeSlotLabel = timeSlot === 'AM' ? '午前の部（10:00〜11:30）' : '午後の部（14:00〜15:30）';

  useEffect(() => {
    const checkFirstTime = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from('reservations')
          .select('id')
          .eq('customer_id', user.id)
          .eq('total_amount', 0)
          .eq('status', 'reserved')
          .limit(1);

        if (fetchError) {
          console.error('checkFirstTime error:', fetchError);
        }

        setIsFirstTime(!data || data.length === 0);
      } catch (e) {
        console.error('checkFirstTime unexpected error:', e);
        setIsFirstTime(true);
      }
      setLoading(false);
    };
    checkFirstTime();
  }, [user]);

  useEffect(() => {
    const fetchPolicy = async () => {
      const { data, error: fetchError } = await supabase
        .from('site_content')
        .select('content_key, title, body')
        .eq('content_key', 'cancellation_policy')
        .maybeSingle();
      if (fetchError) {
        console.error('cancellation policy fetch error:', fetchError);
      }
      if (data) setPolicy(data as SiteContent);
    };
    fetchPolicy();
  }, []);

  // Free only when the tour itself is flagged first-free AND user has no prior free booking.
  const freePrice = !!tour.is_first_free && isFirstTime === true;
  const unitPrice = freePrice ? 0 : tour.price;
  const totalAmount = unitPrice * ticketCount;

  const createReservation = async (paymentMethod: 'free' | 'card') => {
    setSubmitting(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('セッションが切れました。再度ログインしてください。');
        setSubmitting(false);
        return null;
      }

      const res = await fetch('/api/reserve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          visit_date: selectedDate,
          time_slot: timeSlot,
          ticket_count: ticketCount,
          tour_type: tour.slug,
          payment_method: paymentMethod,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '予約に失敗しました');
        setSubmitting(false);
        return null;
      }

      return data.reservation;
    } catch (e) {
      console.error('Reserve: unexpected error', e);
      setError('予約処理中にエラーが発生しました');
      setSubmitting(false);
      return null;
    }
  };

  const handleFreeReserve = async () => {
    const reservation = await createReservation('free');
    if (reservation) onComplete(reservation.order_no);
  };

  const handlePayment = () => {
    // TODO(SBペイメント): 審査完了後、ここでリンク型決済画面へリダイレクト。
    //   手順: /api/reserve で仮予約作成(payment_method='card', status='pending_payment') →
    //          SBペイメントの決済URLを発行して location.href で遷移 →
    //          成功コールバックで payment_authorized_at を更新し status='reserved'。
    console.log('[payment placeholder]', {
      slug: tour.slug,
      amount: totalAmount,
      ticket_count: ticketCount,
      visit_date: selectedDate,
      time_slot: timeSlot,
    });
    alert('決済機能は準備中です。恐れ入りますが、お電話にてお問い合わせください。');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Tour info bar */}
      <div className="flex items-center gap-2 p-3 rounded-lg mb-6" style={{ backgroundColor: tour.colorLight }}>
        <span className="text-2xl">{tour.icon}</span>
        <span className="font-bold" style={{ color: tour.color }}>{tour.name}</span>
      </div>

      {/* Futureshop連携ステータス */}
      {isFutureshopLinked ? (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
          <span className="text-blue-600 font-bold text-sm">✓ Futureshop会員連携済み</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg mb-4">
          <span className="text-gray-500 text-sm">
            オンラインショップ会員登録がまだの方は
            <a href="https://cctest26120203.trial.future-shop.net/p/register" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline ml-1">こちら</a>
          </span>
        </div>
      )}

      <h2 className="text-lg font-bold text-gray-800 mb-6 text-center">予約内容の確認</h2>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex justify-between border-b border-gray-100 pb-3">
          <span className="text-gray-500">体験名</span>
          <span className="font-bold">{tour.icon} {tour.name}</span>
        </div>
        <div className="flex justify-between border-b border-gray-100 pb-3">
          <span className="text-gray-500">日付</span>
          <span className="font-bold">{dateLabel}</span>
        </div>
        <div className="flex justify-between border-b border-gray-100 pb-3">
          <span className="text-gray-500">時間帯</span>
          <span className="font-bold">{timeSlotLabel}</span>
        </div>
        <div className="flex justify-between border-b border-gray-100 pb-3">
          <span className="text-gray-500">参加人数</span>
          <span className="font-bold">{ticketCount}名</span>
        </div>
        <div className="flex justify-between border-b border-gray-100 pb-3">
          <span className="text-gray-500">お名前</span>
          <span className="font-bold">{displayName}</span>
        </div>
        <div className="flex justify-between border-b border-gray-100 pb-3">
          <span className="text-gray-500">メール</span>
          <span className="font-bold text-sm">{displayEmail}</span>
        </div>
        {displayPhone ? (
          <div className="flex justify-between">
            <span className="text-gray-500">電話番号</span>
            <span className="font-bold">{displayPhone}</span>
          </div>
        ) : (
          <div className="flex justify-between">
            <span className="text-gray-500">電話番号</span>
            <span className="text-gray-400 text-sm">未登録</span>
          </div>
        )}
      </div>

      {/* Price section */}
      <div className="mt-6">
        {freePrice ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
            <p className="text-lg font-bold text-green-700">🎉 初回無料</p>
            <p className="text-3xl font-bold text-green-700 mt-1">¥0</p>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-xl p-5 text-center">
            <p className="text-3xl font-bold text-gray-800">¥{totalAmount.toLocaleString()}</p>
            <p className="text-sm text-gray-500 mt-1">(¥{tour.price.toLocaleString()} × {ticketCount}名)</p>
          </div>
        )}
      </div>

      {/* Cancellation policy */}
      {policy && (
        <div className="mt-6 border border-gray-200 rounded-xl p-5 bg-white">
          {policy.title && (
            <h3 className="font-bold text-gray-800 mb-2">{policy.title}</h3>
          )}
          {policy.body && (
            <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
              {policy.body}
            </p>
          )}
          <label className="mt-4 flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-1 w-4 h-4"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span className="text-sm text-gray-800 font-bold">
              上記キャンセルポリシーに同意する
            </span>
          </label>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
      )}

      {/* Action buttons */}
      <div className="mt-6 flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 border-2 border-gray-300 rounded-xl text-gray-600 font-bold text-lg hover:bg-gray-50 min-h-[48px]"
        >
          ← 戻る
        </button>
        {freePrice ? (
          <button
            onClick={handleFreeReserve}
            disabled={submitting || (!!policy && !agreed)}
            className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            {submitting ? '予約中...' : '予約を確定する'}
          </button>
        ) : (
          <button
            onClick={handlePayment}
            disabled={!!policy && !agreed}
            className="flex-1 py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            クレジットカードでお支払い
          </button>
        )}
      </div>
    </div>
  );
}
