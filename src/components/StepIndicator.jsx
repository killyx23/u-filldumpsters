
import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

export const StepIndicator = ({ currentStep, highestStep = currentStep, onStepClick }) => {
  const steps = [
    { number: 1, title: 'Booking Details' },
    { number: 2, title: 'Add-ons' },
    { number: 3, title: 'Review' },
    { number: 4, title: 'Contact Info' },
    { number: 5, title: 'Terms & Conditions' },
    { number: 6, title: 'Required Agreement' },
    { number: 7, title: 'Driver & Vehicle Verification' },
    { number: 8, title: 'Verify Email' },
    { number: 9, title: 'Payment' }
  ];

  return (
    <div className="w-full max-w-7xl mx-auto mb-8 px-4 mt-8">
      <div className="overflow-x-auto pb-6 hide-scrollbar">
        <div className="flex justify-between items-center relative min-w-max px-4">
          <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-1 bg-white/20 rounded-full" />
          
          <motion.div
            className="absolute left-4 top-1/2 -translate-y-1/2 h-1 bg-yellow-400 rounded-full"
            initial={{ width: '0%' }}
            animate={{ width: `calc(${((currentStep - 1) / (steps.length - 1)) * 100}% - 2rem)` }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          />

          {steps.map((step) => {
            const isActive = currentStep === step.number;
            const isPast = currentStep > step.number;
            const isClickable = step.number <= highestStep;
            
            return (
              <div key={step.number} className="relative z-10 flex flex-col items-center mx-4">
                <motion.button
                  onClick={() => isClickable && onStepClick && onStepClick(step.number)}
                  disabled={!isClickable}
                  initial={false}
                  animate={{
                    backgroundColor: isActive || isPast ? '#EAB308' : '#1F2937',
                    borderColor: isActive || isPast ? '#EAB308' : '#4B5563',
                    scale: isActive ? 1.2 : 1
                  }}
                  className={`w-8 h-8 md:w-10 md:h-10 rounded-full border-2 flex items-center justify-center font-bold transition-all duration-300 outline-none
                    ${(isActive || isPast) ? 'text-black shadow-lg shadow-yellow-900/50' : 'text-gray-400'}
                    ${isClickable && !isActive ? 'cursor-pointer hover:scale-110 hover:shadow-yellow-500/50' : ''}
                    ${!isClickable ? 'opacity-70 cursor-not-allowed' : ''}
                  `}
                >
                  {isPast ? <Check className="w-4 h-4 md:w-5 md:h-5" /> : step.number}
                </motion.button>
                <span className={`absolute top-full mt-3 text-xs font-semibold whitespace-nowrap transition-colors duration-300 max-w-[120px] text-center leading-tight
                  ${isActive ? 'text-yellow-400' : isPast ? 'text-white' : 'text-gray-500'}
                  ${isClickable && !isActive ? 'cursor-pointer hover:text-yellow-200' : ''}
                `}
                onClick={() => isClickable && onStepClick && onStepClick(step.number)}
                >
                  {step.title}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
