'use client';

import { useEffect, useState } from 'react';
import { TourInfo } from '@/lib/types';
import QRCode from 'qrcode';

interface CompletionProps {
  tour: TourInfo;
  selectedDate: string;
  timeSlot: 'morning' | 'afternoon';
  ticketCount: number;
  orderNo: string;
  onReset: () => void;
}

export default function Completion({ tour, selectedDate, timeSlot, ticketCount, orderNo, onReset }: CompletionProps) {
  const [qrDataUrl, setQrDataUrl] = useState('');

  const dateObj = new Date(selectedDate + 'T00:00:00');
  const dateLabel = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
  const timeSlotLabel = timeSlot === 'morning' ? '午前の部（10:00〜11:30）' : '午後の部（14:00〜15:30）';

  useEffect(() => {
    QRCode.toDataURL(orderNo, { width: 200, margin: 2 }).then(setQrDataUrl);
  }, [orderNo]);

  return (
    <div className="animate-fade-in text-center">
      <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
        <span className="text-white text-3xl">✓</span>
      </div>

      <h2 className="text-2xl font-bold text-gray-800 mb-2">予約が完了しました！</h2>
      <p className="text-gray-500 mb-6">QRコード付きのメールをお送りしました</p>

      {/* QR Code */}
      {qrDataUrl && (
        <div className="mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} alt="QRコード" className="mx-auto" width={200} height={200} />
          <p className="text-sm text-gray-500 mt-2">受注番号: {orderNo}</p>
        </div>
      )}

      {/* Reservation details */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 text-left space-y-3 max-w-md mx-auto">
        <div className="flex justify-between">
          <span className="text-gray-500">体験名</span>
          <span className="font-bold">{tour.icon} {tour.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">日時</span>
          <span className="font-bold">{dateLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">時間帯</span>
          <span className="font-bold">{timeSlotLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">参加人数</span>
          <span className="font-bold">{ticketCount}名</span>
        </div>
      </div>

      <button
        onClick={onReset}
        className="mt-8 py-3 px-8 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors min-h-[48px]"
      >
        トップに戻る
      </button>
    </div>
  );
}
