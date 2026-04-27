'use client';

import { useState, useEffect, useMemo } from 'react';
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

// payment_messages テーブルの実カラムは message_key / message_text / description。
// title / body は誤りで、SELECT すると 400 になる。
type PaymentMessage = {
  message_key: string;
  message_text: string | null;
  description: string | null;
};

type TourCancelPolicy = {
  has_first_visit_free: boolean | null;
  cancel_policy_2days_rate: number | null;
  cancel_policy_1day_rate: number | null;
  cancel_policy_today_rate: number | null;
};

function applyPlaceholders(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_m, key) =>
    key in vars ? String(vars[key]) : `{${key}}`
  );
}

export default function Confirmation({ tour, selectedDate, timeSlot, ticketCount, onBack, onComplete }: ConfirmationProps) {
  const { user, profile, futureshopMember } = useAuth();
  const [isFirstTime, setIsFirstTime] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [policy, setPolicy] = useState<SiteContent | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [paymentMessages, setPaymentMessages] = useState<Record<string, PaymentMessage>>({});
  const [tourPolicy, setTourPolicy] = useState<TourCancelPolicy | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const isFutureshopLinked = !!futureshopMember || !!profile?.futureshop_member_id;

  const displayName = futureshopMember
    ? `${futureshopMember.lastName} ${futureshopMember.firstName}`.trim()
    : profile?.display_name || user?.user_metadata?.display_name || user?.email || '';
  const displayEmail = futureshopMember?.mail || profile?.email || user?.email || '';
  const displayPhone = futureshopMember?.telNoMain || profile?.phone || '';

  const dateObj = new Date(selectedDate + 'T00:00:00');
  const dateLabel = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
  const timeSlotLabel = timeSlot === 'AM' ? '午前の部（10:00〜11:30）' : '午後の部（14:00〜15:30）';

  // Phase 2: 全顧客にオーソリ。表示金額はツアー料金 × 人数（割引なし）。
  const totalAmount = tour.price * ticketCount;
  const requiresPayment = totalAmount > 0;

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const checkFirstTime = async () => {
      try {
        // has_first_visit_free 適用判定:
        //   同一email × 同一tour_type で payment_status が
        //   authorized / captured / cancel_charged のいずれかの予約があれば2回目以降。
        //   authorized を含めないと、未チェックインのオーソリ済み予約が複数あった場合に
        //   全て初回扱いになり、無料体験が複数回適用されてしまう不具合が起きる。
        const email = (profile?.email || user.email || '').trim().toLowerCase();
        if (!email) {
          setIsFirstTime(true);
          return;
        }
        const { data, error: fetchError } = await supabase
          .from('reservations')
          .select('id')
          .eq('buyer_email', email)
          .eq('tour_type', tour.slug)
          .in('payment_status', ['authorized', 'captured', 'cancel_charged'])
          .limit(1);

        if (fetchError) {
          console.error('checkFirstTime error:', fetchError);
        }
        setIsFirstTime(!data || data.length === 0);
      } catch (e) {
        console.error('checkFirstTime unexpected error:', e);
        setIsFirstTime(true);
      } finally {
        setLoading(false);
      }
    };
    checkFirstTime();
  }, [user, profile, tour.slug]);

  useEffect(() => {
    const fetchAux = async () => {
      const [policyRes, msgsRes, tourRes] = await Promise.all([
        supabase
          .from('site_content')
          .select('content_key, title, body')
          .eq('content_key', 'cancellation_policy')
          .maybeSingle(),
        supabase.from('payment_messages').select('message_key, message_text, description'),
        supabase
          .from('tour_types')
          .select('has_first_visit_free, cancel_policy_2days_rate, cancel_policy_1day_rate, cancel_policy_today_rate')
          .eq('slug', tour.slug)
          .maybeSingle(),
      ]);

      if (policyRes.data) setPolicy(policyRes.data as SiteContent);
      if (msgsRes.data) {
        const map: Record<string, PaymentMessage> = {};
        for (const row of msgsRes.data as PaymentMessage[]) {
          map[row.message_key] = row;
        }
        setPaymentMessages(map);
      }
      if (tourRes.data) setTourPolicy(tourRes.data as TourCancelPolicy);
    };
    fetchAux();
  }, [tour.slug]);

  // 表示メッセージ判定: has_first_visit_free=true かつ初回のみ first_visit メッセージ。
  const confirmMessage = useMemo<PaymentMessage | null>(() => {
    const isFirstFree = !!tourPolicy?.has_first_visit_free && isFirstTime === true;
    const key = isFirstFree ? 'reserve_confirm_first_visit' : 'reserve_confirm_paid';
    return paymentMessages[key] ?? null;
  }, [paymentMessages, tourPolicy, isFirstTime]);

  const renderedConfirmBody = useMemo(() => {
    if (!confirmMessage?.message_text) return '';
    return applyPlaceholders(confirmMessage.message_text, {
      amount: totalAmount.toLocaleString(),
      buyer_name: displayName,
      visit_date: dateLabel,
      time_slot: timeSlotLabel,
      tour_name: tour.name,
    });
  }, [confirmMessage, totalAmount, displayName, dateLabel, timeSlotLabel, tour.name]);

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

      return data;
    } catch (e) {
      console.error('Reserve: unexpected error', e);
      setError('予約処理中にエラーが発生しました');
      setSubmitting(false);
      return null;
    }
  };

  const handleFreeReserve = async () => {
    const result = await createReservation('free');
    if (result?.reservation) onComplete(result.reservation.order_no);
  };

  // 「同意して決済に進む」: 1) 予約レコード作成 → 2) hidden form で /api/payment/initiate に POST。
  // /api/payment/initiate は SBペイメントのリンク型へ自動 submit する Shift-JIS HTML を返す。
  const handleProceedToPayment = async () => {
    setShowConfirm(false);
    const result = await createReservation('card');
    if (!result?.reservation) return;

    const reservation = result.reservation;
    const tourName: string = result.tourName ?? tour.name;

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/payment/initiate';
    form.style.display = 'none';

    const fields: Record<string, string | number> = {
      reservationId: reservation.id,
      email: reservation.buyer_email ?? displayEmail,
      tourTypeSlug: tour.slug,
      tourTypeName: tourName,
      amount: reservation.authorized_amount ?? totalAmount,
      ticketCount,
    };

    for (const [k, v] of Object.entries(fields)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = String(v);
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
  };

  const handlePaymentClick = () => {
    if (!requiresPayment) return;
    setShowConfirm(true);
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

      {isFutureshopLinked ? (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
          <span className="text-blue-600 font-bold text-sm">✓ Futureshop会員連携済み</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg mb-4">
          <span className="text-gray-500 text-sm">
            オンラインショップ会員登録がまだの方は
            <a href="https://kouragumi.com/p/register" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline ml-1">こちら</a>
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
        {!requiresPayment ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
            <p className="text-lg font-bold text-green-700">🎉 無料体験</p>
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
          {tourPolicy && (
            <ul className="mt-3 text-sm text-gray-700 space-y-1">
              <li>2日前: {tourPolicy.cancel_policy_2days_rate ?? 0}%</li>
              <li>前日: {tourPolicy.cancel_policy_1day_rate ?? 0}%</li>
              <li>当日: {tourPolicy.cancel_policy_today_rate ?? 0}%</li>
            </ul>
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
        {!requiresPayment ? (
          <button
            onClick={handleFreeReserve}
            disabled={submitting || (!!policy && !agreed)}
            className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            {submitting ? '予約中...' : '予約を確定する'}
          </button>
        ) : (
          <button
            onClick={handlePaymentClick}
            disabled={submitting || (!!policy && !agreed)}
            className="flex-1 py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            {submitting ? '処理中...' : 'クレジットカードでお支払い'}
          </button>
        )}
      </div>

      {/* 決済前の確認ダイアログ */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-800 mb-3">
              {confirmMessage?.description || 'お支払い前の確認'}
            </h3>
            <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
              {renderedConfirmBody || `クレジットカードで ¥${totalAmount.toLocaleString()} のオーソリ（与信確保）を行います。`}
            </p>
            {tourPolicy && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-700">
                <p className="font-bold mb-1">キャンセル料率</p>
                <ul className="space-y-0.5">
                  <li>2日前: {tourPolicy.cancel_policy_2days_rate ?? 0}%</li>
                  <li>前日: {tourPolicy.cancel_policy_1day_rate ?? 0}%</li>
                  <li>当日: {tourPolicy.cancel_policy_today_rate ?? 0}%</li>
                </ul>
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2 border-2 border-gray-300 rounded-lg text-gray-600 font-bold hover:bg-gray-50"
              >
                戻る
              </button>
              <button
                onClick={handleProceedToPayment}
                disabled={submitting}
                className="flex-1 py-2 bg-primary text-white rounded-lg font-bold hover:bg-primary-dark disabled:opacity-50"
              >
                {submitting ? '処理中...' : '同意して決済に進む'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
