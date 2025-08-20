
import React, { useState, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';

import { dumpsterPlans } from '@/data/plans';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

import { Plans } from '@/components/Plans';
import { BookingForm } from '@/components/BookingForm';
import { AddonsForm } from '@/components/AddonsForm';
import { PaymentPage } from '@/components/PaymentPage';
import { UserAgreement } from '@/components/UserAgreement';

const stripePromise = loadStripe("pk_test_51RqqSuEtrZrskUBvkxDA2WoWo0ceA2cHyFQBBbSQ9zxPaxMaBaizd1gteqQkA1heNW84b4V08gttanJuCj4Q77pr00FWtGRp28");

const initialBookingData = {
  name: '', email: '', phone: '', street: '', city: '', state: '', zip: '',
  dropOffDate: null, pickupDate: null, dropOffTimeSlot: '', pickupTimeSlot: '',
};

export default function BookingJourney() {
  const [step, setStep] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [bookingData, setBookingData] = useState(initialBookingData);
  const [addonsData, setAddonsData] = useState(null);
  const [totalPrice, setTotalPrice] = useState(0);
  const [showAgreement, setShowAgreement] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [bookingId, setBookingId] = useState(null);

  const initialAddonsData = useMemo(() => {
    if (!selectedPlan) return null;
    const isDumpsterOrMaterial = selectedPlan.id === 1 || selectedPlan.id === 3;
    return {
      insurance: 'accept',
      drivewayProtection: isDumpsterOrMaterial ? 'accept' : 'decline',
      equipment: [],
      notes: '',
      addressVerificationSkipped: false,
    };
  }, [selectedPlan]);
  
  // Initialize addonsData when plan is selected
  const handlePlanSelect = (plan) => {
    setSelectedPlan(plan);
    const isDumpsterOrMaterial = plan.id === 1 || plan.id === 3;
    setAddonsData({
      insurance: 'accept',
      drivewayProtection: isDumpsterOrMaterial ? 'accept' : 'decline',
      equipment: [],
      notes: '',
      addressVerificationSkipped: false,
    });
    setStep(1);
  };

  const handleBookingFormSubmit = (price, addressVerificationSkipped) => {
    setTotalPrice(price);
    setAddonsData(prev => ({ ...prev, addressVerificationSkipped }));
    setStep(2);
  };

  const handleAddonsSubmit = async (finalPrice) => {
    const dropOffDate = bookingData.dropOffDate ? new Date(bookingData.dropOffDate) : new Date();
    const pickupDate = bookingData.pickupDate ? new Date(bookingData.pickupDate) : new Date();

    const pendingBookingPayload = {
      name: bookingData.name,
      email: bookingData.email,
      phone: bookingData.phone,
      street: bookingData.street,
      city: bookingData.city,
      state: bookingData.state,
      zip: bookingData.zip,
      drop_off_time_slot: bookingData.dropOffTimeSlot,
      pickup_time_slot: bookingData.pickupTimeSlot,
      plan: selectedPlan,
      addons: addonsData,
      total_price: finalPrice,
      status: 'pending_payment',
      drop_off_date: dropOffDate.toISOString().split('T')[0],
      pickup_date: pickupDate.toISOString().split('T')[0],
      notes: addonsData.notes,
    };

    try {
      const { data, error } = await supabase
        .from('bookings')
        .insert(pendingBookingPayload)
        .select('id')
        .single();

      if (error) throw error;

      setBookingId(data.id);
      setTotalPrice(finalPrice);
      setStep(3);

    } catch (error) {
      toast({
        title: "Booking Error",
        description: "Could not create a pending booking. Please try again.",
        variant: "destructive",
        duration: 15000,
      });
      console.error("Error creating pending booking:", error);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return <Plans plans={dumpsterPlans} onSelectPlan={handlePlanSelect} />;
      case 1:
        return (
          <BookingForm
            plan={selectedPlan}
            bookingData={bookingData}
            setBookingData={setBookingData}
            onSubmit={handleBookingFormSubmit}
            onBack={() => setStep(0)}
            onShowAgreement={() => setShowAgreement(true)}
            agreementAccepted={agreementAccepted}
          />
        );
      case 2:
        return (
          <AddonsForm
            plan={selectedPlan}
            basePrice={totalPrice}
            addonsData={addonsData}
            setAddonsData={setAddonsData}
            onSubmit={handleAddonsSubmit}
            onBack={handleBack}
          />
        );
      case 3:
        return (
          <Elements stripe={stripePromise}>
            <PaymentPage
              totalPrice={totalPrice}
              bookingData={bookingData}
              plan={selectedPlan}
              addonsData={addonsData}
              onBack={handleBack}
              bookingId={bookingId}
            />
          </Elements>
        );
      default:
        return <Plans plans={dumpsterPlans} onSelectPlan={handlePlanSelect} />;
    }
  };

  return (
    <>
      <AnimatePresence mode="wait">
        {renderStep()}
      </AnimatePresence>
      <AnimatePresence>
        {showAgreement && (
          <UserAgreement
            plan={selectedPlan}
            onClose={() => setShowAgreement(false)}
            onAccept={() => {
              setAgreementAccepted(true);
              setShowAgreement(false);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
