'use client';

import { TourUIRecord } from '@/lib/types';
import { sanitizeRichText } from '@/lib/sanitize';

interface TourCardProps {
  tour: TourUIRecord;
}

export default function TourCard({ tour }: TourCardProps) {
  return (
    <div
      className="rounded-xl border-2 overflow-hidden bg-white mb-6 animate-fade-in"
      style={{ borderColor: tour.color, backgroundColor: tour.colorLight }}
    >
      <div className="w-full aspect-[16/9] bg-gray-100 flex items-center justify-center overflow-hidden">
        {tour.photo_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={tour.photo_url}
            alt={tour.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-5xl opacity-60">{tour.icon}</span>
        )}
      </div>

      <div className="p-4 bg-white">
        <h3 className="font-bold text-lg mb-1 flex items-center gap-2" style={{ color: tour.color }}>
          <span>{tour.icon}</span>
          <span>{tour.name}</span>
        </h3>

        {tour.description && (
          <div
            className="text-sm text-gray-600 whitespace-pre-line mb-3 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: sanitizeRichText(tour.description) }}
          />
        )}

        <div className="flex items-center gap-2 flex-wrap mb-2">
          {tour.is_first_free ? (
            <>
              <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                初回無料
              </span>
              <span className="text-sm text-gray-500">
                （2回目以降 ¥{tour.price.toLocaleString()}）
              </span>
            </>
          ) : (
            <span className="font-bold text-lg">¥{tour.price.toLocaleString()}</span>
          )}
        </div>

        {tour.notice_text && (
          <div className="mt-3 p-2 rounded bg-yellow-50 border border-yellow-200 text-xs text-yellow-800 flex gap-1 leading-snug">
            <span>⚠️</span>
            <span
              className="whitespace-pre-line"
              dangerouslySetInnerHTML={{ __html: sanitizeRichText(tour.notice_text) }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
