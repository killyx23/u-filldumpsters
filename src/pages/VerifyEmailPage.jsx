import React from 'react';
import { VerifyEmailBeforeBooking } from '@/components/VerifyEmailBeforeBooking';
import { useNavigate } from 'react-router-dom';

export const VerifyEmailPage = () => {
  const navigate = useNavigate();

  const handleBack = () => {
    navigate('/');
  };

  return <VerifyEmailBeforeBooking onBack={handleBack} />;
};

export default VerifyEmailPage;