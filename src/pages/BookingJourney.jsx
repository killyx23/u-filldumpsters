import React, { useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Toaster } from '@/components/ui/toaster';
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
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { StepIndicator } from '@/components/StepIndicator';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise =
  typeof stripePublishableKey === 'string' && stripePublishableKey.trim()
    ? loadStripe(stripePublishableKey)
    : null;

function BookingJourney() {
  const [currentStep, setCurrentStep] = useState(0);
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
  // Only need clientSecret now — no paymentIntentId needed in frontend
  const [clientSecret, setClientSecret] = useState('');

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

    try {
      // Step 1: Create pending booking via RPC
      const { data, error } = await supabase
        .rpc('create_pending_booking', { payload: pendingBookingPayload });
      if (error) throw error;

      // Step 2: Update customer with license info if provided
      if (addonsData.licenseImageUrls?.length > 0) {
        const { error: customerUpdateError } = await supabase
          .from('customers')
          .update({
            license_plate: addonsData.licensePlate,
            license_image_urls: addonsData.licenseImageUrls,
          })
          .eq('id', data.customer_id);
        if (customerUpdateError) {
          console.warn("Could not update customer with license info, but proceeding:", customerUpdateError);
        }
      }

      // Step 3: Decrement equipment inventory if equipment was selected
      if (addonsData.equipment?.length > 0) {
        const equipmentToDecrement = addonsData.equipment.map(item => ({
          equipment_id: item.dbId,
          quantity: item.quantity,
        }));
        const { error: decrementError } = await supabase
          .rpc('decrement_equipment_quantities', {
            items_to_decrement: equipmentToDecrement,
          });
        if (decrementError) {
          console.error("Failed to decrement equipment quantities, but proceeding:", decrementError);
          toast({
            title: "Inventory Warning",
            description: "Could not update equipment inventory. Please check manually.",
            variant: "destructive",
          });
        }
      }

      setBookingId(data.id);

      // Step 4: Create payment intent — only need clientSecret now
      const { data: paymentIntentData, error: paymentIntentError } = await supabase
        .functions.invoke('create-payment-intent', {
          body: { amount: Math.round(finalPrice * 100), bookingId: data.id },
        });
      if (paymentIntentError) throw paymentIntentError;

      const secret = paymentIntentData?.clientSecret || paymentIntentData?.client_secret;
      if (!secret) throw new Error("Could not retrieve secure payment details from server.");

      setClientSecret(secret);
      setCurrentStep(9);
      window.scrollTo(0, 0);

    } catch (error) {
      console.error("[BookingJourney] Error:", error);
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

  // Stripe Elements appearance config
  const elementsOptions = clientSecret ? {
    clientSecret,
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#facc15',       // yellow-400
        colorBackground: '#1e293b',    // slate-800
        colorText: '#f1f5f9',          // slate-100
        colorDanger: '#ef4444',        // red-500
        fontFamily: '"Inter", system-ui, sans-serif',
        borderRadius: '8px',
      },
      rules: {
        '.Input': {
          backgroundColor: '#0f172a',  // slate-900
          border: '1px solid rgba(255,255,255,0.15)',
        },
        '.Input:focus': {
          border: '1px solid #facc15',
          boxShadow: '0 0 0 2px rgba(250,204,21,0.2)',
        },
        '.Label': { color: '#94a3b8' } // slate-400
      }
    }
  } : null;

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
        if (!stripePromise) {
          return (
            <div className="container mx-auto px-4 py-8">
              <div className="max-w-4xl mx-auto bg-red-900/40 border border-red-500/50 p-4 rounded-lg text-red-200 font-semibold flex items-center shadow-lg">
                <AlertTriangle className="h-6 w-6 mr-3 flex-shrink-0 text-red-400" />
                <p>Payment configuration is missing. Please set VITE_STRIPE_PUBLISHABLE_KEY and reload.</p>
              </div>
            </div>
          );
        }
        // Show loader while clientSecret is being set
        if (!clientSecret || !elementsOptions) {
          return (
            <div className="flex flex-col justify-center items-center h-96 text-white">
              <Loader2 className="h-16 w-16 animate-spin text-yellow-400 mb-4" />
              <span className="text-xl font-medium">Preparing Secure Payment...</span>
              <p className="text-gray-400 mt-2">Connecting to payment gateway</p>
            </div>
          );
        }
        return (
          <div className="container mx-auto px-4 py-8">
            {addonsData?.deliveryAddress && !addonsData.deliveryAddress.isVerified && (
              <div className="max-w-4xl mx-auto bg-amber-900/40 border border-amber-500/50 p-4 rounded-lg mb-6 text-amber-200 font-semibold flex items-center shadow-lg">
                <AlertTriangle className="h-6 w-6 mr-3 flex-shrink-0 text-amber-400" />
                <p>⚠️ Your delivery address could not be automatically verified. Distance fees may be estimated manually by our team.</p>
              </div>
            )}
            {/* Elements wraps PaymentPage and provides clientSecret context */}
            <Elements stripe={stripePromise} options={elementsOptions}>
              <PaymentPage
                totalPrice={finalPrice}
                bookingData={bookingData}
                plan={selectedPlan}
                addonsData={addonsData}
                onBack={() => handleBack(8)}
                bookingId={bookingId}
                deliveryService={deliveryService}
              />
            </Elements>
          </div>
        );
      default:
        return (
          <>
            <Hero />
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
        <StepIndicator currentStep={currentStep} />
      )}
      {renderContent()}
    </ErrorBoundary>
  );
}

export default BookingJourney;