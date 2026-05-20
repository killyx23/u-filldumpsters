
import React from 'react';
import { PaymentPage as PaymentComponent } from '@/components/PaymentPage';
import { StepIndicator } from '@/components/StepIndicator';
import { useBookingStepperNavigation } from '@/hooks/useBookingStepperNavigation';

export const PaymentPage = () => {
  const { highestStep, requiresDriverVerification, handleStepClick, goBackOneStep } =
    useBookingStepperNavigation(9);

  return (
    <div className="min-h-screen">
      <StepIndicator
        currentStep={9}
        highestStep={highestStep}
        onStepClick={handleStepClick}
        requiresDriverVerification={requiresDriverVerification}
      />
      <PaymentComponent onBack={goBackOneStep} />
    </div>
  );
};

export default PaymentPage;
