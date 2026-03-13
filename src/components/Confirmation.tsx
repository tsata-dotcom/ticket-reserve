'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { TourInfo } from '@/lib/types';
import { supabase } from '@/lib/supabase';

interface ConfirmationProps {
  tour: TourInfo;
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

  const unitPrice = isFirstTime ? 0 : tour.price;
  const totalAmount = unitPrice * ticketCount;

  const handleReserve = async () => {
    setSubmitting(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('セッションが切れました。再度ログインしてください。');
        setSubmitting(false);
        return;
      }

      console.log('Reserve: sending request');

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
          tour_type: tour.name,
          unit_price: unitPrice,
          total_amount: totalAmount,
        }),
      });

      const data = await res.json();
      console.log('Reserve: response', { ok: res.ok, data });

      if (!res.ok) {
        setError(data.error || '予約に失敗しました');
        setSubmitting(false);
        return;
      }

      onComplete(data.reservation.order_no);
    } catch (e) {
      console.error('Reserve: unexpected error', e);
      setError('予約処理中にエラーが発生しました');
      setSubmitting(false);
    }
  };

  const handlePayment = () => {
    alert('決済機能は現在準備中です。恐れ入りますが、お電話にてお問い合わせください。');
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
        {displayPhone && (
          <div className="flex justify-between">
            <span className="text-gray-500">電話番号</span>
            <span className="font-bold">{displayPhone}</span>
          </div>
        )}
        {!displayPhone && (
          <div className="flex justify-between">
            <span className="text-gray-500">電話番号</span>
            <span className="text-gray-400 text-sm">未登録</span>
          </div>
        )}
      </div>

      {/* Price section */}
      <div className="mt-6">
        {isFirstTime ? (
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
        {isFirstTime ? (
          <button
            onClick={handleReserve}
            disabled={submitting}
            className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-lg hover:bg-green-700 transition-colors disabled:opacity-50 min-h-[48px]"
          >
            {submitting ? '予約中...' : '予約を確定する'}
          </button>
        ) : (
          <button
            onClick={handlePayment}
            className="flex-1 py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors min-h-[48px]"
          >
            決済ページへ進む
          </button>
        )}
      </div>
    </div>
  );
}
