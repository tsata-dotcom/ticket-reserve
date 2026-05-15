'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { TourTypeRecord, toTourUI } from '@/lib/types';
import Header from '@/components/Header';
import StepIndicator, { Step } from '@/components/StepIndicator';
import TourCard from '@/components/TourCard';
import Calendar from '@/components/Calendar';
import TimeSlotSelector from '@/components/TimeSlotSelector';
import LoginForm from '@/components/LoginForm';
import RegisterForm from '@/components/RegisterForm';
import Confirmation from '@/components/Confirmation';
import Completion from '@/components/Completion';

interface TourBookingFlowProps {
  tour: TourTypeRecord;
  // SSR で事前取得した absolute モード用の日付一覧。
  // Calendar 初期化に渡すことで /api/availability 応答待ちのブランクを排除する。
  initialAbsoluteDates?: string[];
}

// 「体験を選ぶ」を除いた4ステップのインジケータ。
// 内部 step は 0=日付, 1=時間/人数, 2=メール認証, 3=予約確認, 4=完了。
const TOUR_STEPS: Step[] = [
  { label: '日付を選ぶ', num: '❶' },
  { label: '時間/人数', num: '❷' },
  { label: 'メール認証', num: '❸' },
  { label: '予約確認', num: '❹' },
  { label: '完了', num: '❺' },
];

function TourFlow({ tour: initialTour, initialAbsoluteDates }: TourBookingFlowProps) {
  const { user, loading } = useAuth();
  const [step, setStep] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [timeSlot, setTimeSlot] = useState<'AM' | 'PM' | null>(null);
  const [ticketCount, setTicketCount] = useState(1);
  const [orderNo, setOrderNo] = useState('');
  const [showRegister, setShowRegister] = useState(false);

  const stepRef = useRef<HTMLDivElement>(null);
  const dateButtonRef = useRef<HTMLDivElement>(null);

  const tour = useMemo(() => toTourUI(initialTour), [initialTour]);

  // 予約確認 (step 3) は認証必須
  useEffect(() => {
    if (step === 3 && !user && !loading) {
      setStep(2);
    }
  }, [step, user, loading]);

  useEffect(() => {
    if (stepRef.current && step > 0) {
      setTimeout(() => stepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [step]);

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    setTimeout(() => dateButtonRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleTimeSlotNext = (slot: 'AM' | 'PM', count: number) => {
    setTimeSlot(slot);
    setTicketCount(count);
    if (user) {
      setStep(3);
    } else {
      setStep(2);
    }
  };

  const handleLoginSuccess = () => {
    setStep(3);
  };

  const handleComplete = (newOrderNo: string) => {
    setOrderNo(newOrderNo);
    setStep(4);
  };

  const handleReset = () => {
    setStep(0);
    setSelectedDate(null);
    setTimeSlot(null);
    setTicketCount(1);
    setOrderNo('');
    setShowRegister(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <Header />
      <main className="max-w-[600px] md:max-w-[800px] mx-auto px-4 pb-12">
        <StepIndicator currentStep={step} steps={TOUR_STEPS} />

        <div ref={stepRef}>
          {/* STEP 0: コースカード（固定）+ 日付選択 */}
          {step === 0 && (
            <div>
              <TourCard tour={tour} />
              <Calendar
                tourSlug={tour.slug}
                bookingRangeMode={tour.booking_range_mode}
                initialAbsoluteDates={initialAbsoluteDates}
                onSelectDate={handleDateSelect}
                selectedDate={selectedDate}
              />
              {selectedDate && (
                <div ref={dateButtonRef} className="mt-6 text-center animate-fade-in">
                  <p className="text-gray-600 mb-3">
                    <span className="font-bold text-primary">{selectedDate.replace(/-/g, '/')}</span> を選択中
                  </p>
                  <button
                    onClick={() => setStep(1)}
                    className="w-full max-w-sm py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors min-h-[48px]"
                  >
                    日時を選ぶ →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 1: 時間帯 + 人数 */}
          {step === 1 && selectedDate && (
            <TimeSlotSelector
              tour={tour}
              selectedDate={selectedDate}
              onBack={() => setStep(0)}
              onNext={handleTimeSlotNext}
              isLoggedIn={!!user}
            />
          )}

          {/* STEP 2: メール認証 */}
          {step === 2 && (
            <div>
              <div className="flex items-center gap-2 p-3 rounded-lg mb-6" style={{ backgroundColor: tour.colorLight }}>
                <span className="text-2xl">{tour.icon}</span>
                <span className="font-bold" style={{ color: tour.color }}>{tour.name}</span>
              </div>

              {showRegister ? (
                <RegisterForm
                  onSuccess={handleLoginSuccess}
                  onSwitchToLogin={() => setShowRegister(false)}
                />
              ) : (
                <LoginForm
                  onSuccess={handleLoginSuccess}
                  onSwitchToRegister={() => setShowRegister(true)}
                />
              )}

              <div className="mt-6">
                <button
                  onClick={() => setStep(1)}
                  className="w-full py-3 border-2 border-gray-300 rounded-xl text-gray-600 font-bold hover:bg-gray-50 min-h-[48px]"
                >
                  ← 戻る
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: 予約確認 (認証必須) */}
          {step === 3 && selectedDate && timeSlot && user && (
            <Confirmation
              tour={tour}
              selectedDate={selectedDate}
              timeSlot={timeSlot}
              ticketCount={ticketCount}
              onBack={() => setStep(1)}
              onComplete={handleComplete}
            />
          )}

          {/* STEP 4: 完了 */}
          {step === 4 && selectedDate && timeSlot && (
            <Completion
              tour={tour}
              selectedDate={selectedDate}
              timeSlot={timeSlot}
              ticketCount={ticketCount}
              orderNo={orderNo}
              onReset={handleReset}
            />
          )}
        </div>
      </main>
    </>
  );
}

export default function TourBookingFlow({ tour, initialAbsoluteDates }: TourBookingFlowProps) {
  return (
    <AuthProvider>
      <TourFlow tour={tour} initialAbsoluteDates={initialAbsoluteDates} />
    </AuthProvider>
  );
}
