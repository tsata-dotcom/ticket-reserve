'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { TourTypeRecord, TOUR_SLUG_META } from '@/lib/types';

interface TourSelectorProps {
  selectedSlug: string | null;
  onSelect: (tour: TourTypeRecord) => void;
}

export default function TourSelector({ selectedSlug, onSelect }: TourSelectorProps) {
  const [tours, setTours] = useState<TourTypeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchTours = async () => {
      const { data, error: fetchError } = await supabase
        .from('tour_types')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (fetchError) {
        console.error('tour_types fetch error:', fetchError);
        setError('体験コースの取得に失敗しました');
      } else {
        setTours(data || []);
      }
      setLoading(false);
    };
    fetchTours();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return <p className="text-center text-red-600 py-8">{error}</p>;
  }

  if (tours.length === 0) {
    return <p className="text-center text-gray-500 py-8">現在ご予約可能な体験はありません</p>;
  }

  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-gray-800 mb-4 text-center">体験を選んでください</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tours.map((tour) => {
          const meta = TOUR_SLUG_META[tour.slug] || { icon: '🎁', color: '#1a6985', colorLight: '#e8f4f8' };
          const isSelected = selectedSlug === tour.slug;
          return (
            <button
              key={tour.id}
              onClick={() => onSelect(tour)}
              className={`relative rounded-xl border-2 text-left overflow-hidden transition-all duration-200 ${
                isSelected ? 'shadow-lg scale-[1.01]' : 'border-gray-200 hover:border-gray-300 hover:shadow'
              }`}
              style={{
                borderColor: isSelected ? meta.color : undefined,
                backgroundColor: isSelected ? meta.colorLight : '#fff',
              }}
            >
              {isSelected && (
                <div
                  className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-white text-sm z-10 shadow"
                  style={{ backgroundColor: meta.color }}
                >
                  ✓
                </div>
              )}

              {/* Photo */}
              <div className="w-full aspect-[16/9] bg-gray-100 flex items-center justify-center overflow-hidden">
                {tour.photo_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={tour.photo_url}
                    alt={tour.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-5xl opacity-60">{meta.icon}</span>
                )}
              </div>

              <div className="p-4">
                <h3 className="font-bold text-lg mb-1 flex items-center gap-2" style={{ color: meta.color }}>
                  <span>{meta.icon}</span>
                  <span>{tour.name}</span>
                </h3>

                {tour.description && (
                  <p className="text-sm text-gray-600 whitespace-pre-line mb-3 leading-relaxed">
                    {tour.description}
                  </p>
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
                    <span className="whitespace-pre-line">{tour.notice_text}</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
