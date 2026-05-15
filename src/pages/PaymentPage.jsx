
import React from 'react';
import { PaymentPage as PaymentComponent } from '@/components/PaymentPage';
import { StepIndicator } from '@/components/StepIndicator';

export const PaymentPage = () => {
  return (
    <div className="min-h-screen">
      <StepIndicator currentStep={9} />
      <PaymentComponent />
    </div>
  );
};

export default PaymentPage;
