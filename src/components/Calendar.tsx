'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookingRangeConfig, getBookingDateRange } from '@/lib/types';

interface DayAvail {
  AM: { remaining: number; status: string };
  PM: { remaining: number; status: string };
}

interface CalendarProps {
  tourSlug: string;
  onSelectDate: (date: string) => void;
  selectedDate: string | null;
}

// /api/availability の bookingRange レスポンス（types.ts の BookingRangeConfig と同形）
type BookingRangeResponse = BookingRangeConfig;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function StatusBadge({ label, status, remaining }: { label: string; status: string; remaining: number }) {
  const config: Record<string, { text: string; bg: string; textColor: string }> = {
    available: { text: `◎`, bg: 'bg-green-100', textColor: 'text-green-700' },
    few: { text: `残${remaining}`, bg: 'bg-orange-100', textColor: 'text-orange-700' },
    full: { text: '満席', bg: 'bg-red-100', textColor: 'text-red-600' },
    closed: { text: '休', bg: 'bg-gray-100', textColor: 'text-gray-400' },
  };
  const c = config[status] || config.closed;

  return (
    <div className={`text-[10px] md:text-xs rounded px-1 py-0.5 ${c.bg} ${c.textColor} leading-tight`}>
      <span className="text-[9px] md:text-[10px] text-gray-500">{label}</span>{' '}
      <span className="font-bold">{c.text}</span>
    </div>
  );
}

export default function Calendar({ tourSlug, onSelectDate, selectedDate }: CalendarProps) {
  const [bookingRange, setBookingRange] = useState<BookingRangeResponse | null>(null);
  // 初期表示は今日の月。bookingRange 受信後、absolute モードかつ最小日が
  // 未来の月にある場合はその月にジャンプする。
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [availability, setAvailability] = useState<Record<string, DayAvail>>({});
  const [loading, setLoading] = useState(false);

  // bookingRange が未取得のうちは従来動作（今日+2日〜今日+1ヶ月）として描画する。
  const { minDate, maxDate } = useMemo(
    () => getBookingDateRange(bookingRange ?? undefined),
    [bookingRange]
  );

  useEffect(() => {
    const fetchAvailability = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/availability?year=${currentMonth.year}&month=${currentMonth.month}&tour_type=${encodeURIComponent(tourSlug)}`
        );
        const data = await res.json();
        setAvailability(data.availability || {});
        if (data.bookingRange) {
          setBookingRange(data.bookingRange as BookingRangeResponse);
        }
      } catch {
        setAvailability({});
      }
      setLoading(false);
    };
    fetchAvailability();
  }, [currentMonth, tourSlug]);

  // absolute モードで minDate が未来月にある場合は、初回受信時にその月へジャンプする。
  // currentMonth=minDate の月に揃ったあとはこの分岐が立たないのでループしない。
  useEffect(() => {
    if (bookingRange?.mode !== 'absolute') return;
    const targetYear = minDate.getFullYear();
    const targetMonth = minDate.getMonth() + 1;
    const ahead =
      targetYear > currentMonth.year ||
      (targetYear === currentMonth.year && targetMonth > currentMonth.month);
    if (ahead) {
      setCurrentMonth({ year: targetYear, month: targetMonth });
    }
  }, [bookingRange, minDate, currentMonth.year, currentMonth.month]);

  // ツアー切替時は bookingRange を一度クリアして、前のツアーの範囲が
  // 一瞬残るのを防ぐ。
  useEffect(() => {
    setBookingRange(null);
  }, [tourSlug]);

  const firstDay = new Date(currentMonth.year, currentMonth.month - 1, 1);
  const lastDay = new Date(currentMonth.year, currentMonth.month, 0).getDate();
  const startWeekday = firstDay.getDay();

  const prevMonth = () => {
    setCurrentMonth((prev) => {
      if (prev.month === 1) return { year: prev.year - 1, month: 12 };
      return { ...prev, month: prev.month - 1 };
    });
  };

  const nextMonth = () => {
    setCurrentMonth((prev) => {
      if (prev.month === 12) return { year: prev.year + 1, month: 1 };
      return { ...prev, month: prev.month + 1 };
    });
  };

  // Prev disabled if showing the month that contains minDate or earlier.
  const isPrevDisabled =
    currentMonth.year < minDate.getFullYear() ||
    (currentMonth.year === minDate.getFullYear() && currentMonth.month <= minDate.getMonth() + 1);

  // Next disabled if showing the month that contains maxDate or later.
  const isNextDisabled =
    currentMonth.year > maxDate.getFullYear() ||
    (currentMonth.year === maxDate.getFullYear() && currentMonth.month >= maxDate.getMonth() + 1);

  // 開催期間とオフセット範囲の重なりが空（minDate > maxDate）になる場合は
  // 現在予約不可とラベル表示する。relative モードで booking_start_date より
  // 十分手前の日付に居る場合などに発生する。
  const isRangeValid = minDate <= maxDate;
  const rangeLabel = isRangeValid
    ? `${minDate.getMonth() + 1}/${minDate.getDate()} 〜 ${maxDate.getMonth() + 1}/${maxDate.getDate()}`
    : '現在ご予約いただける日付はありません';

  return (
    <div className="animate-fade-in mt-6">
      <h2 className="text-lg font-bold text-gray-800 mb-2 text-center">日付を選んでください</h2>
      <p className="text-xs text-gray-500 text-center mb-4">
        ご予約可能期間: <span className="font-bold text-gray-700">{rangeLabel}</span>
      </p>

      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={prevMonth}
          disabled={isPrevDisabled}
          className="px-3 py-2 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px]"
        >
          ← 前月
        </button>
        <h3 className="text-xl font-bold text-gray-800">
          {currentMonth.year}年{currentMonth.month}月
        </h3>
        <button
          onClick={nextMonth}
          disabled={isNextDisabled}
          className="px-3 py-2 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px]"
        >
          翌月 →
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 justify-center mb-3 text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-300" />◎ 空きあり</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300" />残りわずか</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-300" />満席</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-300" />休／期間外</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 bg-gray-50">
            {WEEKDAYS.map((day, i) => (
              <div
                key={day}
                className={`text-center text-sm font-bold py-2 ${
                  i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-600'
                }`}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7">
            {/* Empty cells before first day */}
            {Array.from({ length: startWeekday }).map((_, i) => (
              <div key={`empty-${i}`} className="border-t border-r border-gray-100 min-h-[70px] md:min-h-[90px]" />
            ))}

            {/* Day cells */}
            {Array.from({ length: lastDay }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${currentMonth.year}-${String(currentMonth.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dateObj = new Date(currentMonth.year, currentMonth.month - 1, day);
              const outOfRange = dateObj < minDate || dateObj > maxDate;
              const dayOfWeek = dateObj.getDay();
              const isSelected = selectedDate === dateStr;
              const avail = availability[dateStr];

              const canSelect =
                !outOfRange &&
                avail &&
                (avail.AM.status !== 'closed' || avail.PM.status !== 'closed') &&
                (avail.AM.status !== 'full' || avail.PM.status !== 'full');

              return (
                <button
                  key={day}
                  disabled={outOfRange || !canSelect}
                  onClick={() => canSelect && onSelectDate(dateStr)}
                  className={`border-t border-r border-gray-100 min-h-[70px] md:min-h-[90px] p-1 text-left flex flex-col transition-colors ${
                    outOfRange
                      ? 'bg-gray-100 opacity-40 cursor-not-allowed'
                      : isSelected
                      ? 'bg-blue-50 ring-2 ring-primary ring-inset'
                      : canSelect
                      ? 'hover:bg-gray-50 cursor-pointer'
                      : 'bg-gray-50 cursor-not-allowed'
                  }`}
                  aria-label={outOfRange ? '予約期間外' : undefined}
                >
                  <span
                    className={`text-[20px] md:text-[24px] font-bold leading-tight ${
                      outOfRange
                        ? 'text-gray-400'
                        : dayOfWeek === 0
                        ? 'text-red-500'
                        : dayOfWeek === 6
                        ? 'text-blue-500'
                        : 'text-gray-800'
                    }`}
                  >
                    {day}
                  </span>
                  {outOfRange ? (
                    <span className="mt-auto text-[9px] md:text-[10px] text-gray-400">期間外</span>
                  ) : (
                    avail && (
                      <div className="mt-auto space-y-0.5">
                        <StatusBadge label="午前" status={avail.AM.status} remaining={avail.AM.remaining} />
                        <StatusBadge label="午後" status={avail.PM.status} remaining={avail.PM.remaining} />
                      </div>
                    )
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
