'use client';

import { TOURS, TourType } from '@/lib/types';

interface TourSelectorProps {
  selectedTour: TourType | null;
  onSelect: (tour: TourType) => void;
}

export default function TourSelector({ selectedTour, onSelect }: TourSelectorProps) {
  return (
    <div className="animate-fade-in">
      <h2 className="text-lg font-bold text-gray-800 mb-4 text-center">体験を選んでください</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TOURS.map((tour) => {
          const isSelected = selectedTour === tour.name;
          return (
            <button
              key={tour.name}
              onClick={() => onSelect(tour.name)}
              className={`relative p-5 rounded-xl border-2 text-left transition-all duration-200 ${
                isSelected
                  ? 'border-current shadow-lg scale-[1.02]'
                  : 'border-gray-200 hover:border-gray-300 hover:shadow'
              }`}
              style={{
                borderColor: isSelected ? tour.color : undefined,
                backgroundColor: isSelected ? tour.colorLight : '#fff',
              }}
            >
              {isSelected && (
                <div
                  className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center text-white text-sm"
                  style={{ backgroundColor: tour.color }}
                >
                  ✓
                </div>
              )}
              <div className="text-3xl mb-2">{tour.icon}</div>
              <h3 className="font-bold text-lg mb-1" style={{ color: tour.color }}>
                {tour.name}
              </h3>
              <p className="text-sm text-gray-500 mb-2">{tour.duration}</p>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg">¥{tour.price.toLocaleString()}</span>
                <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                  初回無料！
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
