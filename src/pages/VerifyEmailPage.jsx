
import React from 'react';
import { VerifyEmailBeforeBooking } from '@/components/VerifyEmailBeforeBooking';
import { StepIndicator } from '@/components/StepIndicator';
import { useNavigate } from 'react-router-dom';

export const VerifyEmailPage = () => {
  const navigate = useNavigate();

  const handleBack = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen">
      <StepIndicator currentStep={8} />
      <VerifyEmailBeforeBooking onBack={handleBack} />
    </div>
  );
};

export default VerifyEmailPage;
