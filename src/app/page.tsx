'use client';

import { useState, useRef, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { TOURS, TourType } from '@/lib/types';
import Header from '@/components/Header';
import StepIndicator from '@/components/StepIndicator';
import TourSelector from '@/components/TourSelector';
import Calendar from '@/components/Calendar';
import TimeSlotSelector from '@/components/TimeSlotSelector';
import LoginForm from '@/components/LoginForm';
import RegisterForm from '@/components/RegisterForm';
import Confirmation from '@/components/Confirmation';
import Completion from '@/components/Completion';

function ReservationFlow() {
  const { user, loading } = useAuth();
  const [step, setStep] = useState(0);
  const [selectedTour, setSelectedTour] = useState<TourType | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [timeSlot, setTimeSlot] = useState<'morning' | 'afternoon' | null>(null);
  const [ticketCount, setTicketCount] = useState(1);
  const [orderNo, setOrderNo] = useState('');
  const [showRegister, setShowRegister] = useState(false);

  const stepRef = useRef<HTMLDivElement>(null);
  const dateButtonRef = useRef<HTMLDivElement>(null);

  // ステップ遷移バリデーション: ステップ3（予約確認）は認証必須
  useEffect(() => {
    if (step === 3 && !user && !loading) {
      console.log('Step validation: user not logged in, redirecting to step 2');
      setStep(2);
    }
  }, [step, user, loading]);

  useEffect(() => {
    if (stepRef.current && step > 0) {
      setTimeout(() => stepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [step]);

  const handleTourSelect = (tour: TourType) => {
    setSelectedTour(tour);
    setSelectedDate(null);
  };

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    setTimeout(() => dateButtonRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleTimeSlotNext = (slot: 'morning' | 'afternoon', count: number) => {
    setTimeSlot(slot);
    setTicketCount(count);
    // ログイン済みならステップ3（予約確認）へ、未ログインならステップ2（ログイン）へ
    if (user) {
      setStep(3);
    } else {
      setStep(2);
    }
  };

  const handleLoginSuccess = () => {
    // ログイン/登録成功 → ステップ3（予約確認）へ
    setStep(3);
  };

  const handleComplete = (newOrderNo: string) => {
    setOrderNo(newOrderNo);
    setStep(4);
  };

  const handleReset = () => {
    setStep(0);
    setSelectedTour(null);
    setSelectedDate(null);
    setTimeSlot(null);
    setTicketCount(1);
    setOrderNo('');
    setShowRegister(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const tour = selectedTour ? TOURS.find(t => t.name === selectedTour)! : null;

  return (
    <>
      <Header />
      <main className="max-w-[600px] md:max-w-[800px] mx-auto px-4 pb-12">
        <StepIndicator currentStep={step} />

        <div ref={stepRef}>
          {/* STEP 0: Tour + Calendar */}
          {step === 0 && (
            <div>
              <TourSelector selectedTour={selectedTour} onSelect={handleTourSelect} />

              {selectedTour && (
                <Calendar
                  tourType={selectedTour}
                  onSelectDate={handleDateSelect}
                  selectedDate={selectedDate}
                />
              )}

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

          {/* STEP 1: Time slot + Count */}
          {step === 1 && tour && selectedDate && (
            <TimeSlotSelector
              tour={tour}
              selectedDate={selectedDate}
              onBack={() => setStep(0)}
              onNext={handleTimeSlotNext}
              isLoggedIn={!!user}
            />
          )}

          {/* STEP 2: Login / Register */}
          {step === 2 && tour && (
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

          {/* STEP 3: Confirmation (認証必須) */}
          {step === 3 && tour && selectedDate && timeSlot && user && (
            <Confirmation
              tour={tour}
              selectedDate={selectedDate}
              timeSlot={timeSlot}
              ticketCount={ticketCount}
              onBack={() => setStep(1)}
              onComplete={handleComplete}
            />
          )}

          {/* STEP 4: Completion */}
          {step === 4 && tour && selectedDate && timeSlot && (
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

export default function Home() {
  return (
    <AuthProvider>
      <ReservationFlow />
    </AuthProvider>
  );
}
