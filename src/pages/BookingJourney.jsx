
import React, { useState, useEffect, useCallback } from 'react';
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
import { CheckoutEmailVerificationStep } from '@/components/CheckoutEmailVerificationStep';
import { toast } from '@/components/ui/use-toast';
import { ReviewsCarousel } from '@/components/ReviewsCarousel';
import { KeyFeatures } from '@/components/KeyFeatures';
import { StepIndicator } from '@/components/StepIndicator';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  storePendingBooking,
  retrievePendingBooking,
  mapPendingToBookingState,
  hydratePlanFromPending,
} from '@/utils/bookingDataPersistence';
import { mapCustomerToBookingData } from '@/utils/returningCustomerMapper';
import { isCustomerPickupService } from '@/utils/customerPickupService';
import { isCheckoutEmailVerified, isCheckoutEmailVerifiedSync } from '@/utils/checkoutEmailVerification';
import { useReturningCustomerDetection } from '@/hooks/useReturningCustomerDetection';
import { useNavigate, useLocation } from 'react-router-dom';
import { useBookingFlow } from '@/contexts/BookingFlowContext';

const INITIAL_BOOKING_DATA = {
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
  termsAccepted: false,
  returningCustomerVerified: false,
  usedReturningCustomerLink: false,
  pendingToken: null,
};

const INITIAL_ADDONS_DATA = {
  insurance: 'accept',
  drivewayProtection: 'decline',
  equipment: [],
  coupon: null,
  deliveryAddress: null,
  deliveryDistance: 0,
  deliveryFee: 0,
};

function BookingJourney({ reorderData, onReorderApplied }) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    updateFlowProgress,
    registerResetCallback,
    unregisterResetCallback,
    requestLeaveBooking,
  } = useBookingFlow();

  const [currentStep, setCurrentStep] = useState(0);
  const [highestStep, setHighestStep] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [bookingData, setBookingData] = useState(INITIAL_BOOKING_DATA);
  const [addonsData, setAddonsData] = useState(INITIAL_ADDONS_DATA);
  const [basePrice, setBasePrice] = useState(0);
  const [finalPrice, setFinalPrice] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deliveryService, setDeliveryService] = useState(false);
  const [agreementFeeSnapshot, setAgreementFeeSnapshot] = useState([]);

  const requiresDriverVerification = isCustomerPickupService(selectedPlan, {
    deliveryService,
    isDelivery: deliveryService,
  });

  const { isReturning: isTrueReturningCustomer } = useReturningCustomerDetection(bookingData.email);
  // Skip Step 7 only when email was already verified via Returning Customer links (or this session).
  const skipEmailVerification = isCheckoutEmailVerifiedSync(bookingData.email, bookingData);
  // Inline Step 7 in the journey is for returning customers only; new customers use /verify-email page (original flow).
  const showInlineEmailStep =
    requiresDriverVerification && isTrueReturningCustomer && !skipEmailVerification;

  useEffect(() => {
    if (currentStep === 7 && (!showInlineEmailStep || skipEmailVerification) && requiresDriverVerification) {
      setCurrentStep(8);
    }
  }, [currentStep, showInlineEmailStep, skipEmailVerification, requiresDriverVerification]);

  const resetBookingState = useCallback(() => {
    setCurrentStep(0);
    setHighestStep(0);
    setSelectedPlan(null);
    setBookingData(INITIAL_BOOKING_DATA);
    setAddonsData(INITIAL_ADDONS_DATA);
    setBasePrice(0);
    setFinalPrice(0);
    setIsProcessing(false);
    setDeliveryService(false);
    setAgreementFeeSnapshot([]);
  }, []);

  useEffect(() => {
    registerResetCallback(resetBookingState);
    return () => unregisterResetCallback();
  }, [registerResetCallback, unregisterResetCallback, resetBookingState]);

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

  useEffect(() => {
    updateFlowProgress({
      currentStep,
      highestStep,
      requiresDriverVerification,
    });
  }, [currentStep, highestStep, requiresDriverVerification, updateFlowProgress]);

  // Scroll after the new step paints — handler scrollTo runs too early and often leaves the viewport mid/bottom.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    return () => cancelAnimationFrame(id);
  }, [currentStep]);

  const applyPendingBookingState = useCallback(async (pending, resumeStep) => {
    const hydratedPlan = await hydratePlanFromPending(pending);
    const mapped = mapPendingToBookingState(pending, hydratedPlan);
    const emailVerified = await isCheckoutEmailVerified(
      mapped.contactInfo.email,
      mapped.contactInfo
    );
    const contactInfo = {
      ...mapped.contactInfo,
      returningCustomerVerified:
        mapped.contactInfo.returningCustomerVerified || emailVerified,
      pendingToken: pending.id || mapped.contactInfo.pendingToken,
    };
    setBookingData(contactInfo);
    setSelectedPlan(mapped.selectedPlan);
    setAddonsData(mapped.addonsData);
    setBasePrice(mapped.basePrice);
    setFinalPrice(mapped.finalPrice);
    setDeliveryService(mapped.deliveryService);
    const resolvedStep = resumeStep ?? 6;
    setCurrentStep(resolvedStep);
    setHighestStep(Math.max(8, resolvedStep));
    updateFlowProgress({
      currentStep: resolvedStep,
      highestStep: Math.max(8, resolvedStep),
      requiresDriverVerification: mapped.requiresDriverVerification,
      pendingToken: contactInfo.pendingToken,
    });
    window.scrollTo(0, 0);
  }, [updateFlowProgress]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const refCode = params.get('ref');
    if (refCode) {
      localStorage.setItem('referral_code', refCode);
    }
  }, [location.search]);

  useEffect(() => {
    const resumeStep = location.state?.resumeStep;
    const token = location.state?.token;
    if (!resumeStep || !token) return;

    const loadResume = async () => {
      const result = await retrievePendingBooking(token);
      if (!result.success) {
        toast({
          title: 'Could not restore booking',
          description: result.error || 'Please start a new booking.',
          variant: 'destructive',
        });
        return;
      }
      applyPendingBookingState(result.bookingData, resumeStep);
      navigate(location.pathname, { replace: true, state: {} });
    };

    loadResume();
  }, [location.state, location.pathname, navigate, applyPendingBookingState]);

  useEffect(() => {
    if (reorderData) {
      handleReorderService(reorderData);
      onReorderApplied?.();
    }
  }, [reorderData]);

  useEffect(() => {
    const reorderBooking = location.state?.reorderBooking;
    if (!reorderBooking) return;

    handleReorderService(reorderBooking);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state?.reorderBooking]);

  useEffect(() => {
    const returningCustomerProfile = location.state?.returningCustomerProfile;
    if (!returningCustomerProfile) return;

    const mapped = mapCustomerToBookingData(returningCustomerProfile.customer, returningCustomerProfile.email);
    setBookingData((prev) => ({
      ...prev,
      ...mapped,
      returningCustomerVerified: true,
      usedReturningCustomerLink: true,
      contactAddress: {
        ...prev.contactAddress,
        ...mapped.contactAddress,
      },
    }));

    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const handleReorderService = async (pastBooking) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BookingJourney] Reordering service from booking:`, pastBooking.id);

    try {
      let plan = pastBooking.plan;
      if (!plan && pastBooking.plan_id) {
        const { data: planData } = await supabase
          .from('plans')
          .select('*')
          .eq('id', pastBooking.plan_id)
          .maybeSingle();
        plan = planData;
      }
      const addons = pastBooking.addons || {};

      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('email', pastBooking.email)
        .maybeSingle();

      if (customerError) {
        console.error(`[${timestamp}] [BookingJourney] Error fetching customer:`, customerError);
      }

      const hasCustomerProfile = Boolean(customer?.id);

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
          customerId: customer?.id || null,
          isVerified: hasCustomerProfile,
        },
        addressVerified: hasCustomerProfile,
        dropOffDate: null,
        pickupDate: null,
        dropOffTimeSlot: '',
        pickupTimeSlot: '',
        notes: '',
        termsAccepted: false,
      });

      setAddonsData({
        insurance: addons.insurance || 'accept',
        drivewayProtection: addons.drivewayProtection || 'decline',
        equipment: addons.equipment || [],
        coupon: null,
        deliveryAddress: addons.deliveryAddress || null,
        deliveryDistance: addons.deliveryDistance || 0,
        deliveryFee: addons.deliveryFee || 0,
      });

      setSelectedPlan(plan);
      setDeliveryService(addons.deliveryService || (plan?.id === 2 && addons.isDelivery) || false);
      setCurrentStep(1);
      setHighestStep(1);

      toast({
        title: 'Booking Pre-filled',
        description: 'Your previous booking details have been loaded. Please select new dates to continue.',
        duration: 5000,
      });

      window.scrollTo(0, 0);
    } catch (error) {
      const catchTs = new Date().toISOString();
      console.error(`[${catchTs}] [BookingJourney] Error in handleReorderService:`, error);
      toast({
        title: 'Reorder Failed',
        description: 'Could not load your previous booking. Please start a new booking.',
        variant: 'destructive',
      });
    }
  };

  const handlePlanSelect = (plan) => {
    setSelectedPlan(plan);
    setCurrentStep(1);
    window.scrollTo(0, 0);
  };

  const handleBookingSubmit = (data, totalPrice, _, __, planData) => {
    setBookingData((prev) => ({ ...prev, ...data }));
    setBasePrice(totalPrice);
    setSelectedPlan(planData.plan);
    setDeliveryService(planData.deliveryService);
    setCurrentStep(2);
    window.scrollTo(0, 0);
  };

  const handleReturningCustomerVerified = (customerData) => {
    setBookingData((prev) => ({
      ...prev,
      ...customerData,
      returningCustomerVerified: true,
      usedReturningCustomerLink: true,
      contactAddress: {
        ...prev.contactAddress,
        ...(customerData?.contactAddress || {}),
      },
    }));
  };

  const handleAddonsSubmit = (total, _, addons) => {
    setFinalPrice(total);
    setAddonsData((prev) => ({ ...prev, ...addons }));
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
    setBookingData((prev) => ({ ...prev, termsAccepted: true }));
    setCurrentStep(6);
    window.scrollTo(0, 0);
  };

  const navigateToVerifyEmail = (token) => {
    const nextHighest = Math.max(highestStep, 7);
    setHighestStep(nextHighest);
    updateFlowProgress({
      currentStep: 7,
      highestStep: nextHighest,
      requiresDriverVerification,
      pendingToken: token,
    });
    navigate(`/verify-email?token=${token}`);
  };

  const navigateToPayment = (token) => {
    const nextHighest = Math.max(highestStep, 9);
    setHighestStep(nextHighest);
    updateFlowProgress({
      currentStep: 9,
      highestStep: nextHighest,
      requiresDriverVerification,
      pendingToken: token,
    });
    navigate(`/payment?bookingId=${token}`);
  };

  const proceedAfterPendingStore = async (token) => {
    const verified = await isCheckoutEmailVerified(bookingData.email, bookingData);
    if (verified) {
      navigateToPayment(token);
    } else {
      navigateToVerifyEmail(token);
    }
  };

  const handleAgreementAccept = async (agreementMeta = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BookingJourney] handleAgreementAccept triggered`);
    const signatureFields = {};

    if (typeof agreementMeta.agreementSignature === 'string') {
      signatureFields.agreementSignature = agreementMeta.agreementSignature;
    }
    if (typeof agreementMeta.agreementSignatureDate === 'string') {
      signatureFields.agreementSignatureDate = agreementMeta.agreementSignatureDate;
    }

    if (Array.isArray(agreementMeta.agreementFeeSnapshot)) {
      setAgreementFeeSnapshot(agreementMeta.agreementFeeSnapshot);
    }
    if (Object.keys(signatureFields).length > 0) {
      setAddonsData((prev) => ({ ...prev, ...signatureFields }));
    }

    if (requiresDriverVerification) {
      if (showInlineEmailStep) {
        console.log(`[${timestamp}] [BookingJourney] Returning pickup — store pending before inline email step`);
        setIsProcessing(true);

        try {
          const result = await storePendingBooking(
            bookingData,
            selectedPlan,
            { ...addonsData, ...signatureFields },
            {
              totalPrice: finalPrice,
              basePrice: basePrice,
              deliveryService: deliveryService,
              agreementFeeSnapshot: Array.isArray(agreementMeta.agreementFeeSnapshot)
                ? agreementMeta.agreementFeeSnapshot
                : agreementFeeSnapshot,
              existingToken: bookingData.pendingToken,
            }
          );

          if (!result.success) {
            toast({
              title: 'Error',
              description: result.error || 'Failed to save booking data. Please try again.',
              variant: 'destructive',
            });
            return;
          }

          const token = result.token;
          const nextHighest = Math.max(highestStep, 7);

          setBookingData((prev) => ({ ...prev, pendingToken: token }));
          setHighestStep(nextHighest);
          updateFlowProgress({
            currentStep: 7,
            highestStep: nextHighest,
            requiresDriverVerification,
            pendingToken: token,
          });
          setCurrentStep(7);
          window.scrollTo(0, 0);
        } catch (error) {
          console.error(`[${timestamp}] [BookingJourney] Exception storing returning pickup pending booking:`, error);
          toast({
            title: 'Error',
            description: 'An unexpected error occurred. Please try again.',
            variant: 'destructive',
          });
        } finally {
          setIsProcessing(false);
        }
        return;
      }

      console.log(`[${timestamp}] [BookingJourney] New-customer pickup — driver verification first (original flow)`);
      const nextHighest = Math.max(highestStep, 8);
      setHighestStep(nextHighest);
      updateFlowProgress({
        currentStep: 8,
        highestStep: nextHighest,
        requiresDriverVerification,
      });
      setCurrentStep(8);
      window.scrollTo(0, 0);
      return;
    }

    console.log(`[${timestamp}] [BookingJourney] Delivery/Full-service selected, storing pending booking and proceeding to email verification`);
    setIsProcessing(true);

    try {
      const result = await storePendingBooking(bookingData, selectedPlan, { ...addonsData, ...signatureFields }, {
        totalPrice: finalPrice,
        basePrice: basePrice,
        deliveryService: deliveryService,
        agreementFeeSnapshot: Array.isArray(agreementMeta.agreementFeeSnapshot)
          ? agreementMeta.agreementFeeSnapshot
          : agreementFeeSnapshot,
      });

      const resultTs = new Date().toISOString();
      if (!result.success) {
        console.error(`[${resultTs}] [BookingJourney] Failed to store pending booking:`, result.error);
        toast({
          title: 'Error',
          description: result.error || 'Failed to save booking data. Please try again.',
          variant: 'destructive',
        });
        setIsProcessing(false);
        return;
      }

      console.log(`[${resultTs}] [BookingJourney] Pending booking stored successfully with token:`, result.token);
      await proceedAfterPendingStore(result.token);
    } catch (error) {
      const catchTs = new Date().toISOString();
      console.error(`[${catchTs}] [BookingJourney] Exception in handleAgreementAccept:`, error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerificationSubmit = async (verificationData) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BookingJourney] handleVerificationSubmit triggered with data:`, verificationData);
    const runId = `run-${Date.now()}`;
    // #region agent log
    fetch('http://127.0.0.1:7835/ingest/6fb2fea7-763c-4173-aa65-46eca4ec1d86',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ac4c4'},body:JSON.stringify({sessionId:'1ac4c4',runId,hypothesisId:'H5',location:'BookingJourney.jsx:handleVerificationSubmit:start',message:'handleVerificationSubmit start',data:{currentStep,isProcessing,emailPresent:Boolean(bookingData?.email),selectedPlanId:selectedPlan?.id,hasLicensePlate:Boolean(verificationData?.licensePlate),hasFrontImage:Boolean(verificationData?.licenseImageUrls?.front),hasBackImage:Boolean(verificationData?.licenseImageUrls?.back),wasSkipped:Boolean(verificationData?.wasVerificationSkipped)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    setAddonsData((prev) => ({ ...prev, ...verificationData }));
    setIsProcessing(true);

    try {
      const result = await storePendingBooking(bookingData, selectedPlan, { ...addonsData, ...verificationData }, {
        totalPrice: finalPrice,
        basePrice: basePrice,
        deliveryService: deliveryService,
        agreementFeeSnapshot,
        existingToken: bookingData.pendingToken,
      });

      const resultTs = new Date().toISOString();
      if (!result.success) {
        console.error(`[${resultTs}] [BookingJourney] Failed to store pending booking:`, result.error);
        // #region agent log
        fetch('http://127.0.0.1:7835/ingest/6fb2fea7-763c-4173-aa65-46eca4ec1d86',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ac4c4'},body:JSON.stringify({sessionId:'1ac4c4',runId,hypothesisId:'H5',location:'BookingJourney.jsx:handleVerificationSubmit:failure',message:'handleVerificationSubmit received failed result',data:{resultError:result.error||null,currentStep,isProcessingAtFailure:isProcessing},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        toast({
          title: 'Error',
          description: result.error || 'Failed to save booking data. Please try again.',
          variant: 'destructive',
        });
        setIsProcessing(false);
        return;
      }

      console.log(`[${resultTs}] [BookingJourney] Pending booking stored successfully with token:`, result.token);
      setBookingData((prev) => ({ ...prev, pendingToken: result.token }));
      // #region agent log
      fetch('http://127.0.0.1:7835/ingest/6fb2fea7-763c-4173-aa65-46eca4ec1d86',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ac4c4'},body:JSON.stringify({sessionId:'1ac4c4',runId,hypothesisId:'H5',location:'BookingJourney.jsx:handleVerificationSubmit:success',message:'handleVerificationSubmit success',data:{tokenPresent:Boolean(result?.token)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      await proceedAfterPendingStore(result.token);
    } catch (error) {
      const catchTs = new Date().toISOString();
      console.error(`[${catchTs}] [BookingJourney] Exception in handleVerificationSubmit:`, error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEmailVerificationComplete = (customerData) => {
    if (customerData) {
      handleReturningCustomerVerified(customerData);
    }
    setCurrentStep(8);
    window.scrollTo(0, 0);
  };

  const goBackOneStep = () => {
    if (currentStep === 1) {
      requestLeaveBooking();
      return;
    }
    if (currentStep === 8) {
      const emailVerified = isCheckoutEmailVerifiedSync(bookingData.email, bookingData);
      if (showInlineEmailStep && !emailVerified) {
        setCurrentStep(7);
      } else {
        setCurrentStep(6);
      }
    } else if (currentStep === 7) {
      setCurrentStep(6);
    } else {
      setCurrentStep(currentStep - 1);
    }
    window.scrollTo(0, 0);
  };

  const handleStepClick = (step) => {
    if (step >= currentStep) return;
    if (step === 7 && (!showInlineEmailStep || skipEmailVerification)) return;
    if (step === 8 && !requiresDriverVerification) return;
    setCurrentStep(step);
    // Top scroll is handled by the currentStep effect after paint.
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
            onBack={goBackOneStep}
            deliveryService={deliveryService}
            setDeliveryService={setDeliveryService}
            onReorderSelect={handleReorderService}
            onCustomerVerified={handleReturningCustomerVerified}
          />
        );
      case 2:
        return (
          <AddonsForm
            basePrice={basePrice}
            addonsData={addonsData}
            setAddonsData={setAddonsData}
            onSubmit={handleAddonsSubmit}
            onBack={goBackOneStep}
            plan={selectedPlan}
            deliveryService={deliveryService}
            contactAddress={bookingData.contactAddress}
            customerEmail={bookingData.email}
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
            onBack={goBackOneStep}
            onContinue={handleReviewContinue}
            deliveryService={deliveryService}
          />
        );
      case 4:
        return (
          <ContactInfoForm
            bookingData={bookingData}
            setBookingData={setBookingData}
            usedReturningCustomerLink={Boolean(bookingData.usedReturningCustomerLink)}
            onSubmit={handleContactSubmit}
            onBack={goBackOneStep}
          />
        );
      case 5:
        return (
          <TermsAndConditionsStep
            onAccept={handleTermsAccept}
            onBack={goBackOneStep}
          />
        );
      case 6:
        return (
          <ComprehensiveAgreement
            bookingData={bookingData}
            onBack={goBackOneStep}
            onAccept={handleAgreementAccept}
            isProcessing={isProcessing}
          />
        );
      case 7:
        return (
          <CheckoutEmailVerificationStep
            email={bookingData.email}
            pendingToken={bookingData.pendingToken}
            onBack={goBackOneStep}
            onVerified={handleEmailVerificationComplete}
            isReturningCustomer={isTrueReturningCustomer}
          />
        );
      case 8:
        return (
          <DriverVehicleVerification
            onVerifiedSubmit={handleVerificationSubmit}
            onBack={goBackOneStep}
            customerId={bookingData.contactAddress?.customerId}
            customerEmail={bookingData.email}
            bookingData={bookingData}
          />
        );
      default:
        return (
          <>
            <Banner />
            <Hero />

            <div id="service-16-yard" className="scroll-mt-24" />
            <div id="service-10-yard" className="scroll-mt-24" />
            <div id="service-6-yard" className="scroll-mt-24" />

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
          requiresDriverVerification={requiresDriverVerification}
          showInlineEmailStep={showInlineEmailStep}
          skipEmailVerification={skipEmailVerification}
        />
      )}
      {renderContent()}
    </ErrorBoundary>
  );
}

export default BookingJourney;
