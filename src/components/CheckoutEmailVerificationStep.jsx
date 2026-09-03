import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReturningCustomerEmailGate } from '@/components/ReturningCustomerEmailGate';
import { mapCustomerToBookingData } from '@/utils/returningCustomerMapper';
import { UiControlGuide } from '@/components/UiControlGuide';
import { getBookingGuideEntries } from '@/config/uiControlGuideEntries';
import { publishCheckoutSyncEvent } from '@/utils/checkoutTabSync';

export const CheckoutEmailVerificationStep = ({
  email,
  pendingToken = null,
  onBack,
  onVerified,
  isReturningCustomer = false,
}) => {
  const handleVerified = ({ email: verifiedEmail, customer }) => {
    if (pendingToken) {
      publishCheckoutSyncEvent({ type: 'verified', pendingId: pendingToken });
    }
    const mapped = customer ? mapCustomerToBookingData(customer, verifiedEmail) : null;
    onVerified?.({
      ...(mapped || {}),
      returningCustomerVerified: true,
      email: verifiedEmail,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="container mx-auto py-16 px-4"
    >
      <div className="max-w-3xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
        <div className="flex items-center mb-8 border-b border-white/10 pb-4">
          <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
            <ArrowLeft />
          </Button>
          <div>
            <h2 className="text-3xl font-bold text-white flex items-center">
              <Mail className="mr-3 h-8 w-8 text-blue-400" />
              Verify Email
            </h2>
            <p className="text-blue-200 mt-1">
              For your security, we must confirm your identity by email before any driver or vehicle documents can be displayed or collected.
            </p>
          </div>
        </div>

        <div className="mb-6 bg-blue-900/30 border border-blue-500/40 rounded-xl p-5 flex items-start gap-3">
          <ShieldCheck className="h-6 w-6 text-blue-300 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-100">
            {isReturningCustomer
              ? 'As a returning customer, your saved license and insurance information will only be shown after this verification is complete. This protects your personal information and helps us comply with privacy requirements.'
              : 'Please verify the email address for this booking before continuing to driver and vehicle verification.'}
          </p>
        </div>
        <p className="mb-6 text-xs text-blue-200/90">
          If you confirm from the email, that link may open a new tab. Finish the booking there, then close this tab — leaving it open can start a timeout on this screen.
        </p>

        <ReturningCustomerEmailGate
          email={email}
          pendingToken={pendingToken}
          onVerified={handleVerified}
          variant="step"
        />

        <UiControlGuide
          stepTitle="Verify Email"
          entries={getBookingGuideEntries('contact')}
          className="mt-4 flex justify-end"
        />
      </div>
    </motion.div>
  );
};
