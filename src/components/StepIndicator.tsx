'use client';

const STEPS = [
  { label: '体験を選ぶ', num: '❶' },
  { label: '日時を選ぶ', num: '❷' },
  { label: 'ログイン', num: '❸' },
  { label: '予約確認', num: '❹' },
  { label: '完了', num: '❺' },
];

interface StepIndicatorProps {
  currentStep: number;
}

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-1 py-4 px-2 overflow-x-auto">
      {STEPS.map((step, index) => {
        const isCompleted = index < currentStep;
        const isCurrent = index === currentStep;

        return (
          <div key={index} className="flex items-center">
            <div className="flex flex-col items-center min-w-[56px]">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  isCompleted
                    ? 'bg-green-500 text-white'
                    : isCurrent
                    ? 'bg-primary text-white'
                    : 'bg-gray-200 text-gray-400'
                }`}
              >
                {isCompleted ? '✓' : index + 1}
              </div>
              <span
                className={`text-[10px] mt-1 text-center whitespace-nowrap ${
                  isCurrent ? 'text-primary font-bold' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={`w-4 md:w-8 h-0.5 mt-[-12px] ${
                  index < currentStep ? 'bg-green-500' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
