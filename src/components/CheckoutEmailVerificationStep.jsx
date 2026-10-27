import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReturningCustomerEmailGate } from '@/components/ReturningCustomerEmailGate';
import { mapCustomerToBookingData } from '@/utils/returningCustomerMapper';
import { UiControlGuide } from '@/components/UiControlGuide';
import { getBookingGuideEntries } from '@/config/uiControlGuideEntries';
import { publishCheckoutSyncEvent } from '@/utils/checkoutTabSync';
import { calculateBookingTotal } from '@/utils/calculateBookingTotal';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';
import { useTaxRate } from '@/utils/getTaxRate';
import { useBookingTaxOptions } from '@/hooks/useBookingTaxOptions';

const money = (amount) => `$${Number(amount || 0).toFixed(2)}`;

function OrderMath({ plan, addonsData, bookingData, deliveryService }) {
  const [equipmentPrices, setEquipmentPrices] = useState({});
  const [loadingPrices, setLoadingPrices] = useState(true);
  const { taxRate, loading: loadingTaxRate } = useTaxRate();
  const { insurancePrice, taxOptions, loading: loadingTaxOptions } = useBookingTaxOptions(plan?.id);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const prices = {};
      try {
        for (let id = 1; id <= 6; id += 1) {
          if (isValidEquipmentId(id)) prices[id] = await getPriceForEquipment(id);
        }
      } catch (error) {
        console.error('[CheckoutEmailVerificationStep] Error loading prices:', error);
      }
      if (!cancelled) {
        setEquipmentPrices(prices);
        setLoadingPrices(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    if (!plan || loadingPrices || loadingTaxRate || loadingTaxOptions) return null;
    const dropOff = bookingData?.dropOffDate || bookingData?.drop_off_date;
    return calculateBookingTotal(
      plan,
      addonsData || {},
      equipmentPrices,
      taxRate,
      deliveryService,
      insurancePrice,
      {
        ...taxOptions,
        dropOff,
        pickup: bookingData?.pickupDate || bookingData?.pickup_date || dropOff,
      }
    );
  }, [
    plan,
    addonsData,
    bookingData?.dropOffDate,
    bookingData?.drop_off_date,
    bookingData?.pickupDate,
    bookingData?.pickup_date,
    deliveryService,
    equipmentPrices,
    taxRate,
    insurancePrice,
    taxOptions,
    loadingPrices,
    loadingTaxRate,
    loadingTaxOptions,
  ]);

  if (!totals) {
    return <p className="mb-6 text-sm text-blue-200">Loading order total…</p>;
  }

  const rows = [
    ['Base Rental', totals.basePriceAmount],
    ['Base Delivery Fee', totals.deliveryFeeFlat],
    ['Mileage Charge', totals.tripMileageCost],
    ['Hardware Protection Plan', totals.insuranceCost],
    ['Driveway Protection', totals.drivewayProtectionCost],
    ['Rent Equipment', totals.rentEquipmentCost],
    ['Items for Purchase', totals.purchaseItemsCost],
    ['Disposal Items', totals.disposalCost],
  ].filter(([, amount]) => Number(amount) > 0);

  return (
    <div className="mb-6 rounded-xl border border-white/15 bg-black/20 p-5">
      <h3 className="mb-3 text-lg font-semibold text-white">Order total</h3>
      <div className="space-y-2 text-sm">
        {rows.map(([label, amount]) => (
          <div key={label} className="flex justify-between">
            <span className="text-blue-200">{label}</span>
            <span className="text-white">{money(amount)}</span>
          </div>
        ))}
        {totals.couponDiscount > 0 && (
          <div className="flex justify-between font-semibold text-green-300">
            <span>Coupon ({addonsData?.coupon?.code || 'Applied'})</span>
            <span>-{money(totals.couponDiscount)}</span>
          </div>
        )}
        {totals.loyaltyDiscount > 0 && (
          <div className="flex justify-between font-semibold text-green-300">
            <span>Loyalty Points</span>
            <span>-{money(totals.loyaltyDiscount)}</span>
          </div>
        )}
        {totals.referralDiscount > 0 && (
          <div className="flex justify-between font-semibold text-green-300">
            <span>Referral Wallet</span>
            <span>-{money(totals.referralDiscount)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-white/15 pt-2">
          <span className="font-semibold text-blue-200">Subtotal</span>
          <span className="font-bold text-white">{money(totals.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-semibold text-blue-200">Tax ({Number(totals.taxRate || 0).toFixed(2)}%)</span>
          <span className="font-bold text-white">{money(totals.tax)}</span>
        </div>
        <div className="flex justify-between border-t border-white/10 pt-2 text-base">
          <span className="font-bold text-white">Total</span>
          <span className="font-bold text-green-400">{money(totals.total)}</span>
        </div>
      </div>
    </div>
  );
}

export const CheckoutEmailVerificationStep = ({
  email,
  pendingToken = null,
  onBack,
  onVerified,
  isReturningCustomer = false,
  plan = null,
  addonsData = null,
  bookingData = null,
  deliveryService = false,
}) => {
  const handleVerified = ({ email: verifiedEmail, customer }) => {
    if (pendingToken) {
      publishCheckoutSyncEvent({
        type: 'verified',
        pendingId: pendingToken,
        email: verifiedEmail || null,
      });
    }
    const mapped = customer ? mapCustomerToBookingData(customer, verifiedEmail) : null;
    onVerified?.({
      ...(mapped || {}),
      returningCustomerVerified: true,
      email: verifiedEmail,
    });
  };

  // When another tab verifies via the email link, BookingFlowContext stands this
  // tab down to the homepage (idle guard). Local typed verify still continues here.

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

        {plan && (
          <OrderMath
            plan={plan}
            addonsData={addonsData}
            bookingData={bookingData}
            deliveryService={deliveryService}
          />
        )}

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
