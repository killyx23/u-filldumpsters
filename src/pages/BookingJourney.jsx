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
import { PaymentPage } from '@/components/PaymentPage';
import { toast } from '@/components/ui/use-toast';
import { ReviewsCarousel } from '@/components/ReviewsCarousel';
import { KeyFeatures } from '@/components/KeyFeatures';
import { StepIndicator } from '@/components/StepIndicator';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { storePendingBooking } from '@/utils/bookingDataPersistence';
import { useNavigate } from 'react-router-dom';

function BookingJourney({ reorderData }) {
  const navigate = useNavigate();
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [deliveryService, setDeliveryService] = useState(false);

  // Handle reorder data from Header modal
  useEffect(() => {
    if (reorderData) {
      handleReorderService(reorderData);
    }
  }, [reorderData]);

  useEffect(() => {
    if (currentStep > highestStep) {
      setHighestStep(currentStep);
    }
  }, [currentStep, highestStep]);

  const handleReorderService = async (pastBooking) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BookingJourney] Reordering service from booking:`, pastBooking.id);

    try {
      const plan = pastBooking.plan;
      const addons = pastBooking.addons || {};

      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('email', pastBooking.email)
        .maybeSingle();

      if (customerError) {
        console.error(`[${timestamp}] [BookingJourney] Error fetching customer:`, customerError);
      }

      setBookingData({
        firstName: customer?.first_name || pastBooking.first_name || '',
        lastName: customer?.last_name || pastBooking.last_name || '',
        email: pastBooking.email,
        phone: customer?.phone || pastBooking.phone || '',
        contactAddress: {
          street: customer?.street || pastBooking.street || '',
          city: customer?.city || pastBooking.city || '',
          state: customer?.state || pastBooking.state || '',
          zip: customer?.zip || pastBooking.zip || '',
          isVerified: true
        },
        addressVerified: true,
        dropOffDate: null,
        pickupDate: null,
        dropOffTimeSlot: '',
        pickupTimeSlot: '',
        notes: '',
        termsAccepted: false
      });

      setAddonsData({
        insurance: addons.insurance || 'decline',
        drivewayProtection: addons.drivewayProtection || 'decline',
        equipment: addons.equipment || [],
        coupon: null,
        deliveryAddress: addons.deliveryAddress || null,
        deliveryDistance: addons.deliveryDistance || 0,
        deliveryFee: addons.deliveryFee || 0
      });

      setSelectedPlan(plan);
      setDeliveryService(addons.deliveryService || (plan?.id === 2 && addons.isDelivery) || false);
      setCurrentStep(1);

      toast({
        title: 'Booking Pre-filled',
        description: 'Your previous booking details have been loaded. Please select new dates to continue.',
        duration: 5000
      });

      window.scrollTo(0, 0);

    } catch (error) {
      const catchTs = new Date().toISOString();
      console.error(`[${catchTs}] [BookingJourney] Error in handleReorderService:`, error);
      toast({
        title: 'Reorder Failed',
        description: 'Could not load your previous booking. Please start a new booking.',
        variant: 'destructive'
      });
    }
  };

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

  const handleAgreementAccept = async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BookingJourney] handleAgreementAccept triggered`);
    
    if (selectedPlan?.id === 2 && !deliveryService) {
      console.log(`[${timestamp}] [BookingJourney] Self-service trailer selected, proceeding to driver verification`);
      setCurrentStep(7);
      window.scrollTo(0, 0);
      return;
    }

    console.log(`[${timestamp}] [BookingJourney] Delivery/Full-service selected, storing pending booking and proceeding to email verification`);
    setIsProcessing(true);

    try {
      const result = await storePendingBooking(bookingData, selectedPlan, addonsData);
      
      const resultTs = new Date().toISOString();
      if (!result.success) {
        console.error(`[${resultTs}] [BookingJourney] Failed to store pending booking:`, result.error);
        toast({
          title: 'Error',
          description: result.error || 'Failed to save booking data. Please try again.',
          variant: 'destructive'
        });
        setIsProcessing(false);
        return;
      }

      console.log(`[${resultTs}] [BookingJourney] Pending booking stored successfully with token:`, result.token);
      navigate(`/verify-email?token=${result.token}`);

    } catch (error) {
      const catchTs = new Date().toISOString();
      console.error(`[${catchTs}] [BookingJourney] Exception in handleAgreementAccept:`, error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerificationSubmit = async (verificationData) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BookingJourney] handleVerificationSubmit triggered with data:`, verificationData);
    
    setAddonsData(prev => ({ ...prev, ...verificationData }));
    setIsProcessing(true);

    try {
      const result = await storePendingBooking(bookingData, selectedPlan, { ...addonsData, ...verificationData });
      
      const resultTs = new Date().toISOString();
      if (!result.success) {
        console.error(`[${resultTs}] [BookingJourney] Failed to store pending booking:`, result.error);
        toast({
          title: 'Error',
          description: result.error || 'Failed to save booking data. Please try again.',
          variant: 'destructive'
        });
        setIsProcessing(false);
        return;
      }

      console.log(`[${resultTs}] [BookingJourney] Pending booking stored successfully with token:`, result.token);
      navigate(`/verify-email?token=${result.token}`);

    } catch (error) {
      const catchTs = new Date().toISOString();
      console.error(`[${catchTs}] [BookingJourney] Exception in handleVerificationSubmit:`, error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBack = (step) => {
    if (currentStep === 7) {
      setCurrentStep(6);
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
            onReorderSelect={handleReorderService}
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
            isProcessing={isProcessing}
          />
        );
      case 7:
        return (
          <DriverVehicleVerification
            onVerifiedSubmit={handleVerificationSubmit}
            onBack={() => handleBack(6)}
            customerId={bookingData.contactAddress?.customerId}
            customerEmail={bookingData.email}
          />
        );
      default:
        return (
          <>
            <Banner />
            <Hero />
            
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
      {currentStep > 0 && currentStep < 8 && (
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