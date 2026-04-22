import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Toaster } from '@/components/ui/toaster';
import { Banner } from '@/components/Banner';
import { Hero } from '@/components/Hero';
import { Plans } from '@/components/Plans';
import { BookingForm } from '@/components/BookingForm';
import { AddonsForm } from '@/components/AddonsForm';
import { BookingSummaryReview } from '@/components/BookingSummaryReview';
import { ContactInfoForm } from '@/components/ContactInfoForm';
import { TermsAndConditionsStep } from '@/components/TermsAndConditionsStep';
import { ComprehensiveAgreement } from '@/components/ComprehensiveAgreement';
import { DriverVehicleVerification } from '@/components/DriverVehicleVerification';
import { VerifyEmailBeforeBooking } from '@/components/VerifyEmailBeforeBooking';
import { PaymentPage } from '@/components/PaymentPage';
import { toast } from '@/components/ui/use-toast';
import { ReviewsCarousel } from '@/components/ReviewsCarousel';
import { KeyFeatures } from '@/components/KeyFeatures';
import { StepIndicator } from '@/components/StepIndicator';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function BookingJourney() {
  const [currentStep, setCurrentStep] = useState(0);
  const [highestStep, setHighestStep] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState(null);

  const [bookingData, setBookingData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    contactAddress: { street: '', city: '', state: '', zip: '', isVerified: false },
    addressVerified: false,
    dropOffDate: null,
    pickupDate: null,
    dropOffTimeSlot: '',
    pickupTimeSlot: '',
    notes: '',
    termsAccepted: false
  });

  const [addonsData, setAddonsData] = useState({
    insurance: 'decline',
    drivewayProtection: 'decline',
    equipment: [],
    coupon: null,
    deliveryAddress: null,
    deliveryDistance: 0,
    deliveryFee: 0
  });

  const [basePrice, setBasePrice] = useState(0);
  const [finalPrice, setFinalPrice] = useState(0);
  const [bookingId, setBookingId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deliveryService, setDeliveryService] = useState(false);

  useEffect(() => {
    if (currentStep > highestStep) {
      setHighestStep(currentStep);
    }
  }, [currentStep, highestStep]);

  const handlePlanSelect = (plan) => {
    setSelectedPlan(plan);
    setCurrentStep(1);
    window.scrollTo(0, 0);
  };

  const handleBookingSubmit = (data, totalPrice, _, __, planData) => {
    setBookingData(prev => ({ ...prev, ...data }));
    setBasePrice(totalPrice);
    setSelectedPlan(planData.plan);
    setDeliveryService(planData.deliveryService);
    setCurrentStep(2);
    window.scrollTo(0, 0);
  };

  const handleAddonsSubmit = (total, _, addons) => {
    setFinalPrice(total);
    setAddonsData(prev => ({ ...prev, ...addons }));
    setCurrentStep(3);
    window.scrollTo(0, 0);
  };

  const handleReviewContinue = () => {
    setCurrentStep(4);
    window.scrollTo(0, 0);
  };

  const handleContactSubmit = () => {
    setCurrentStep(5);
    window.scrollTo(0, 0);
  };

  const handleTermsAccept = () => {
    setBookingData(prev => ({ ...prev, termsAccepted: true }));
    setCurrentStep(6);
    window.scrollTo(0, 0);
  };

  const handleAgreementAccept = () => {
    if (selectedPlan?.id === 2 && !deliveryService) {
      setCurrentStep(7);
    } else {
      setCurrentStep(8);
    }
    window.scrollTo(0, 0);
  };

  const handleVerificationSubmit = (verificationData) => {
    setAddonsData(prev => ({ ...prev, ...verificationData }));
    setCurrentStep(8);
    window.scrollTo(0, 0);
  };

  const handleVerifyEmailComplete = async () => {
    setIsProcessing(true);
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BookingJourney] handleVerifyEmailComplete triggered. Preparing to create booking in Supabase.`);

    const fullName = `${bookingData.firstName} ${bookingData.lastName}`.trim();
    const isUnverifiedDelivery = addonsData.deliveryAddress && !addonsData.deliveryAddress.isVerified;

    const pendingBookingPayload = {
      name: fullName,
      first_name: bookingData.firstName,
      last_name: bookingData.lastName,
      email: bookingData.email,
      phone: bookingData.phone,
      street: bookingData.contactAddress.street,
      city: bookingData.contactAddress.city,
      state: bookingData.contactAddress.state,
      zip: bookingData.contactAddress.zip,
      contact_address: bookingData.contactAddress,
      delivery_address: addonsData.deliveryAddress || bookingData.contactAddress,
      notes: bookingData.notes,
      drop_off_date: bookingData.dropOffDate
        ? new Date(bookingData.dropOffDate).toISOString().substring(0, 10)
        : null,
      pickup_date: bookingData.pickupDate
        ? new Date(bookingData.pickupDate).toISOString().substring(0, 10)
        : null,
      drop_off_time_slot: bookingData.dropOffTimeSlot,
      pickup_time_slot: bookingData.pickupTimeSlot,
      plan: selectedPlan,
      total_price: finalPrice,
      status: 'pending_payment',
      was_verification_skipped: isUnverifiedDelivery,
      verification_notes: addonsData.verificationNotes || null,
      addons: {
        ...addonsData,
        distanceInfo: {
          miles: addonsData.deliveryDistance,
          totalFee: addonsData.deliveryFee,
          unverifiedAddress: isUnverifiedDelivery,
        },
        isDelivery: deliveryService,
      },
    };

    console.log(`[${timestamp}] [BookingJourney] Payload for create_pending_booking:`, JSON.stringify(pendingBookingPayload, null, 2));

    try {
      console.log(`[${timestamp}] [BookingJourney] Calling supabase.rpc('create_pending_booking')`);
      const { data, error } = await supabase.rpc('create_pending_booking', { payload: pendingBookingPayload });
      
      const rpcEndTs = new Date().toISOString();
      if (error) {
        console.error(`[${rpcEndTs}] [BookingJourney] create_pending_booking RPC failed:`, error);
        throw error;
      }

      console.log(`[${rpcEndTs}] [BookingJourney] Booking successfully created! Returned data:`, data);
      
      if (!data || !data.id) {
        console.error(`[${rpcEndTs}] [BookingJourney] RPC returned success but data.id is missing! Returned object:`, data);
        throw new Error("Booking creation succeeded but ID was not returned by the server.");
      }

      setBookingId(data.id);
      console.log(`[${rpcEndTs}] [BookingJourney] Successfully extracted and set bookingId: ${data.id}`);

      if (addonsData.licenseImageUrls?.length > 0) {
        console.log(`[${rpcEndTs}] [BookingJourney] Updating customer ID ${data.customer_id} with license information.`);
        const { error: customerUpdateError } = await supabase
          .from('customers')
          .update({
            license_plate: addonsData.licensePlate,
            license_image_urls: addonsData.licenseImageUrls,
          })
          .eq('id', data.customer_id);
        if (customerUpdateError) {
          console.warn(`[${new Date().toISOString()}] [BookingJourney] Could not update customer with license info:`, customerUpdateError);
        }
      }

      if (addonsData.equipment?.length > 0) {
        console.log(`[${new Date().toISOString()}] [BookingJourney] Decrementing equipment quantities.`);
        const equipmentToDecrement = addonsData.equipment.map(item => ({
          equipment_id: item.dbId,
          quantity: item.quantity,
        }));
        const { error: decrementError } = await supabase
          .rpc('decrement_equipment_quantities', {
            items_to_decrement: equipmentToDecrement,
          });
        if (decrementError) {
          console.error(`[${new Date().toISOString()}] [BookingJourney] Failed to decrement equipment quantities:`, decrementError);
        }
      }

      console.log(`[${new Date().toISOString()}] [BookingJourney] Navigating to Payment Page with confirmed booking_id: ${data.id}`);
      setCurrentStep(9);
      window.scrollTo(0, 0);

    } catch (error) {
      console.error(`[${new Date().toISOString()}] [BookingJourney] CRITICAL ERROR during booking creation:`, error);
      toast({
        title: 'Booking Error',
        description: `Could not create your booking record. Please try again. ${error.message}`,
        variant: 'destructive',
        duration: 30000,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBack = (step) => {
    if (currentStep === 8) {
      if (selectedPlan?.id !== 2 || deliveryService) {
        setCurrentStep(6);
      } else {
        setCurrentStep(7);
      }
    } else {
      setCurrentStep(step);
    }
    window.scrollTo(0, 0);
  };

  const handleStepClick = (step) => {
    if (step <= highestStep) {
      setCurrentStep(step);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const renderContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <BookingForm
            plan={selectedPlan}
            bookingData={bookingData}
            setBookingData={setBookingData}
            onSubmit={handleBookingSubmit}
            onBack={() => handleBack(0)}
            deliveryService={deliveryService}
            setDeliveryService={setDeliveryService}
          />
        );
      case 2:
        return (
          <AddonsForm
            basePrice={basePrice}
            addonsData={addonsData}
            setAddonsData={setAddonsData}
            onSubmit={handleAddonsSubmit}
            onBack={() => handleBack(1)}
            plan={selectedPlan}
            deliveryService={deliveryService}
            contactAddress={bookingData.contactAddress}
          />
        );
      case 3:
        return (
          <BookingSummaryReview
            bookingData={bookingData}
            plan={selectedPlan}
            addonsData={addonsData}
            basePrice={basePrice}
            totalPrice={finalPrice}
            onBack={() => handleBack(2)}
            onContinue={handleReviewContinue}
            deliveryService={deliveryService}
          />
        );
      case 4:
        return (
          <ContactInfoForm
            bookingData={bookingData}
            setBookingData={setBookingData}
            onSubmit={handleContactSubmit}
            onBack={() => handleBack(3)}
          />
        );
      case 5:
        return (
          <TermsAndConditionsStep
            onAccept={handleTermsAccept}
            onBack={() => handleBack(4)}
          />
        );
      case 6:
        return (
          <ComprehensiveAgreement
            bookingData={bookingData}
            onBack={() => handleBack(5)}
            onAccept={handleAgreementAccept}
            isProcessing={false}
          />
        );
      case 7:
        return (
          <DriverVehicleVerification
            onVerifiedSubmit={handleVerificationSubmit}
            onBack={() => handleBack(6)}
          />
        );
      case 8:
        return (
          <VerifyEmailBeforeBooking
            bookingData={{
              ...bookingData,
              street: bookingData.contactAddress?.street,
              city: bookingData.contactAddress?.city,
              state: bookingData.contactAddress?.state,
              zip: bookingData.contactAddress?.zip,
            }}
            addonsData={addonsData}
            plan={selectedPlan}
            totalPrice={finalPrice}
            onBack={() => handleBack(7)}
            onComplete={handleVerifyEmailComplete}
            isProcessing={isProcessing}
          />
        );
      case 9:
        return (
          <PaymentPage
            totalPrice={finalPrice}
            bookingData={bookingData}
            plan={selectedPlan}
            addonsData={addonsData}
            onBack={() => handleBack(8)}
            bookingId={bookingId}
            deliveryService={deliveryService}
          />
        );
      default:
        return (
          <>
            <Banner />
            <Hero />
            
            {/* Scroll anchors for ProductShowcase */}
            <div id="service-16-yard" className="scroll-mt-24"></div>
            <div id="service-10-yard" className="scroll-mt-24"></div>
            <div id="service-6-yard" className="scroll-mt-24"></div>

            <Plans onSelectPlan={handlePlanSelect} />
            <ReviewsCarousel />
            <KeyFeatures />
          </>
        );
    }
  };

  return (
    <ErrorBoundary>
      <Toaster />
      {currentStep > 0 && currentStep < 10 && (
        <StepIndicator 
          currentStep={currentStep} 
          highestStep={highestStep} 
          onStepClick={handleStepClick} 
        />
      )}
      {renderContent()}
    </ErrorBoundary>
  );
}

export default BookingJourney;