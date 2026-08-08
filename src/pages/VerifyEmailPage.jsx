
import React from 'react';
import { VerifyEmailBeforeBooking } from '@/components/VerifyEmailBeforeBooking';
import { StepIndicator } from '@/components/StepIndicator';
import { useBookingStepperNavigation } from '@/hooks/useBookingStepperNavigation';

export const VerifyEmailPage = () => {
  const { highestStep, requiresDriverVerification, handleStepClick, goBackOneStep } =
    useBookingStepperNavigation(7);

  return (
    <div className="min-h-screen">
      <StepIndicator
        currentStep={7}
        highestStep={highestStep}
        onStepClick={handleStepClick}
        requiresDriverVerification={requiresDriverVerification}
      />
      <VerifyEmailBeforeBooking onBack={goBackOneStep} />
    </div>
  );
};

export default VerifyEmailPage;
