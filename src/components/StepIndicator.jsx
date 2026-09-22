
import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

export const StepIndicator = ({
  currentStep,
  highestStep = currentStep,
  onStepClick,
  requiresDriverVerification = true,
  showInlineEmailStep = false,
  skipEmailVerification = false,
}) => {
  const steps = [
    { number: 1, title: 'Booking Details' },
    { number: 2, title: 'Add-ons' },
    { number: 3, title: 'Review' },
    { number: 4, title: 'Contact Info' },
    { number: 5, title: 'Terms & Conditions' },
    { number: 6, title: 'Required Agreement' },
    { number: 7, title: 'Verify Email' },
    { number: 8, title: 'Driver & Vehicle Verification' },
    { number: 9, title: 'Payment' },
  ];

  const isStepSkipped = (stepNumber) =>
    (stepNumber === 7 && (!requiresDriverVerification || !showInlineEmailStep || skipEmailVerification)) ||
    (stepNumber === 8 && !requiresDriverVerification);

  return (
    <div className="w-full max-w-7xl mx-auto mb-8 px-4 mt-8">
      <motion.div className="overflow-x-auto pb-6 hide-scrollbar">
        <div className="flex justify-between items-center relative min-w-max px-4">
          <motion.div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-1 bg-white/20 rounded-full" />

          <motion.div
            className="absolute left-4 top-1/2 -translate-y-1/2 h-1 bg-yellow-400 rounded-full"
            initial={{ width: '0%' }}
            animate={{ width: `calc(${((currentStep - 1) / (steps.length - 1)) * 100}% - 2rem)` }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          />

          {steps.map((step) => {
            const skipped = isStepSkipped(step.number);
            const isActive = currentStep === step.number;
            const isPast = currentStep > step.number;
            const canNavigate =
              Boolean(onStepClick) &&
              !skipped &&
              step.number < currentStep &&
              step.number <= highestStep;

            return (
              <div key={step.number} className="relative z-10 flex flex-col items-center mx-4">
                <motion.button
                  type="button"
                  onClick={() => canNavigate && onStepClick(step.number)}
                  disabled={!canNavigate}
                  initial={false}
                  animate={{
                    backgroundColor: skipped
                      ? '#374151'
                      : isActive || isPast
                        ? '#EAB308'
                        : '#1F2937',
                    borderColor: skipped
                      ? '#4B5563'
                      : isActive || isPast
                        ? '#EAB308'
                        : '#4B5563',
                    scale: isActive ? 1.2 : 1,
                    opacity: skipped ? 0.4 : 1,
                  }}
                  className={`w-8 h-8 md:w-10 md:h-10 rounded-full border-2 flex items-center justify-center font-bold transition-all duration-300 outline-none
                    ${!skipped && (isActive || isPast) ? 'text-black shadow-lg shadow-yellow-900/50' : 'text-gray-400'}
                    ${canNavigate ? 'cursor-pointer hover:scale-110 hover:shadow-yellow-500/50' : 'cursor-default'}
                    ${!canNavigate && !isActive && !isPast && !skipped ? 'opacity-70' : ''}
                  `}
                  aria-label={step.title}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isPast && !skipped ? (
                    <Check className="w-4 h-4 md:w-5 md:h-5" />
                  ) : (
                    step.number
                  )}
                </motion.button>
                <span
                  role={canNavigate ? 'button' : undefined}
                  tabIndex={canNavigate ? 0 : undefined}
                  onClick={() => canNavigate && onStepClick(step.number)}
                  onKeyDown={(e) => {
                    if (canNavigate && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onStepClick(step.number);
                    }
                  }}
                  className={`absolute top-full mt-3 text-xs font-semibold whitespace-nowrap transition-colors duration-300 max-w-[120px] text-center leading-tight
                    ${isActive ? 'text-yellow-400' : isPast && !skipped ? 'text-white' : 'text-gray-500'}
                    ${canNavigate ? 'cursor-pointer hover:text-yellow-200' : ''}
                    ${skipped ? 'opacity-40 line-through' : ''}
                  `}
                >
                  {step.title}
                </span>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};
