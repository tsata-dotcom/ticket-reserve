'use client';

import { useEffect, useState, useRef } from 'react';
import { TourInfo } from '@/lib/types';

interface TimeSlotSelectorProps {
  tour: TourInfo;
  selectedDate: string;
  onBack: () => void;
  onNext: (timeSlot: 'morning' | 'afternoon', count: number) => void;
  isLoggedIn: boolean;
}

interface SlotAvail {
  remaining: number;
  status: string;
}

export default function TimeSlotSelector({ tour, selectedDate, onBack, onNext, isLoggedIn }: TimeSlotSelectorProps) {
  const [morningAvail, setMorningAvail] = useState<SlotAvail | null>(null);
  const [afternoonAvail, setAfternoonAvail] = useState<SlotAvail | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<'morning' | 'afternoon' | null>(null);
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const dateObj = new Date(selectedDate + 'T00:00:00');
  const dateLabel = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;

  useEffect(() => {
    const fetchSlots = async () => {
      setLoading(true);
      const d = new Date(selectedDate);
      const res = await fetch(
        `/api/availability?year=${d.getFullYear()}&month=${d.getMonth() + 1}&tour_type=${encodeURIComponent(tour.name)}`
      );
      const data = await res.json();
      const dayAvail = data.availability?.[selectedDate];
      if (dayAvail) {
        setMorningAvail(dayAvail.morning);
        setAfternoonAvail(dayAvail.afternoon);
      }
      setLoading(false);
    };
    fetchSlots();
  }, [selectedDate, tour.name]);

  useEffect(() => {
    if (selectedSlot) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [selectedSlot, count]);

  const maxCount = selectedSlot === 'morning'
    ? morningAvail?.remaining || 0
    : selectedSlot === 'afternoon'
    ? afternoonAvail?.remaining || 0
    : 1;

  const handleSlotSelect = (slot: 'morning' | 'afternoon') => {
    setSelectedSlot(slot);
    setCount(1);
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
      <button
        onClick={onBack}
        className="w-full flex items-center gap-2 p-3 rounded-lg mb-4"
        style={{ backgroundColor: tour.colorLight }}
      >
        <span className="text-2xl">{tour.icon}</span>
        <div className="text-left">
          <span className="font-bold text-sm" style={{ color: tour.color }}>{tour.name}</span>
          <span className="text-sm text-gray-600 ml-2">{dateLabel}</span>
        </div>
        <span className="ml-auto text-xs text-gray-400">← 変更</span>
      </button>

      <h2 className="text-lg font-bold text-gray-800 mb-4 text-center">時間帯を選んでください</h2>

      <div className="space-y-3">
        {/* Morning slot */}
        <button
          disabled={morningAvail?.status === 'full' || morningAvail?.status === 'closed'}
          onClick={() => handleSlotSelect('morning')}
          className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
            selectedSlot === 'morning'
              ? 'border-primary bg-primary-light shadow-md'
              : morningAvail?.status === 'full' || morningAvail?.status === 'closed'
              ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-lg">午前の部</p>
              <p className="text-sm text-gray-500">10:00〜11:30</p>
            </div>
            <div className="text-right">
              {morningAvail?.status === 'full' ? (
                <span className="text-red-500 font-bold">満席</span>
              ) : morningAvail?.status === 'closed' ? (
                <span className="text-gray-400 font-bold">休</span>
              ) : (
                <span className={`font-bold ${morningAvail?.status === 'few' ? 'text-orange-500' : 'text-green-600'}`}>
                  残り{morningAvail?.remaining}枠
                </span>
              )}
            </div>
          </div>
        </button>

        {/* Afternoon slot */}
        <button
          disabled={afternoonAvail?.status === 'full' || afternoonAvail?.status === 'closed'}
          onClick={() => handleSlotSelect('afternoon')}
          className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
            selectedSlot === 'afternoon'
              ? 'border-primary bg-primary-light shadow-md'
              : afternoonAvail?.status === 'full' || afternoonAvail?.status === 'closed'
              ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-lg">午後の部</p>
              <p className="text-sm text-gray-500">14:00〜15:30</p>
            </div>
            <div className="text-right">
              {afternoonAvail?.status === 'full' ? (
                <span className="text-red-500 font-bold">満席</span>
              ) : afternoonAvail?.status === 'closed' ? (
                <span className="text-gray-400 font-bold">休</span>
              ) : (
                <span className={`font-bold ${afternoonAvail?.status === 'few' ? 'text-orange-500' : 'text-green-600'}`}>
                  残り{afternoonAvail?.remaining}枠
                </span>
              )}
            </div>
          </div>
        </button>
      </div>

      {/* Count selector */}
      {selectedSlot && (
        <div className="mt-6 animate-fade-in">
          <h3 className="font-bold text-gray-800 mb-3 text-center">参加人数</h3>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setCount(Math.max(1, count - 1))}
              className="w-12 h-12 rounded-full border-2 border-gray-300 text-xl font-bold text-gray-600 hover:bg-gray-50 flex items-center justify-center"
            >
              −
            </button>
            <span className="text-3xl font-bold text-gray-800 w-16 text-center">{count}</span>
            <button
              onClick={() => setCount(Math.min(maxCount, count + 1))}
              disabled={count >= maxCount}
              className="w-12 h-12 rounded-full border-2 border-gray-300 text-xl font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
            >
              ＋
            </button>
          </div>
          <p className="text-center text-sm text-gray-500 mt-2">最大 {maxCount}名</p>

          {/* Price display */}
          <div className="mt-4 p-4 bg-gray-50 rounded-xl text-center">
            <p className="text-2xl font-bold text-gray-800">
              ¥{(tour.price * count).toLocaleString()}
            </p>
            <p className="text-sm text-gray-500">(¥{tour.price.toLocaleString()} × {count}名)</p>
            <span className="inline-block mt-2 bg-red-500 text-white text-sm px-3 py-1 rounded-full font-bold">
              🎉 初回のお客様は無料！
            </span>
          </div>

          {/* Action buttons */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={onBack}
              className="flex-1 py-3 border-2 border-gray-300 rounded-xl text-gray-600 font-bold text-lg hover:bg-gray-50 min-h-[48px]"
            >
              ← 戻る
            </button>
            <button
              onClick={() => onNext(selectedSlot, count)}
              className="flex-1 py-3 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors min-h-[48px]"
            >
              {isLoggedIn ? '予約内容を確認 →' : 'ログインして予約 →'}
            </button>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
