import React, { useState } from 'react';
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
    import { cn } from '@/lib/utils';

    const stripePromise = loadStripe("pk_test_51RqqSuEtrZrskUBvkxDA2WoWo0ceA2cHyFQBBbSQ9zxPaxMaBaizd1gteqQkA1heNW84b4V08gttanJuCj4Q77pr00FWtGRp28");

    const initialBookingData = {
      name: '', email: '', phone: '', street: '', city: '', state: '', zip: '',
      dropOffDate: null, pickupDate: null, dropOffTimeSlot: '', pickupTimeSlot: '',
    };

    const StepIndicator = ({ currentStep, onStepClick }) => {
      const steps = ["Service", "Details", "Add-ons", "Payment"];
      return (
        <div className="w-full max-w-md mx-auto mb-8">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <React.Fragment key={index}>
                <div className="flex flex-col items-center">
                  <button
                    onClick={() => onStepClick(index)}
                    disabled={index >= currentStep}
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold transition-all duration-300",
                      currentStep > index ? "bg-green-500 text-white cursor-pointer hover:bg-green-600" : "",
                      currentStep === index ? "bg-yellow-400 text-black" : "",
                      currentStep < index ? "bg-gray-600 text-gray-400 cursor-not-allowed" : ""
                    )}
                  >
                    {index + 1}
                  </button>
                  <span className={cn("text-xs mt-2", currentStep >= index ? "text-white" : "text-gray-400")}>{step}</span>
                </div>
                {index < steps.length - 1 && (
                  <div className={cn(
                    "flex-1 h-1 mx-2 transition-colors duration-300",
                    currentStep > index ? "bg-green-500" : "bg-gray-600"
                  )}></div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      );
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
      
      const handlePlanSelect = (plan) => {
        setSelectedPlan(plan);
        setBookingData(initialBookingData);
        setAgreementAccepted(false);
        const isDumpsterOrMaterial = plan.id === 1 || plan.id === 3;
        setAddonsData({
          insurance: 'accept',
          drivewayProtection: isDumpsterOrMaterial ? 'accept' : 'decline',
          equipment: [],
          notes: '',
          addressVerificationSkipped: false,
          verificationSkipped: false,
          distanceInfo: null,
        });
        setStep(1);
      };

      const handleBookingFormSubmit = (price, addressVerificationSkipped, distanceInfo) => {
        setTotalPrice(price);
        setAddonsData(prev => ({ ...prev, addressVerificationSkipped, distanceInfo }));
        setStep(2);
      };

      const handleAddonsSubmit = async (finalPrice, verificationData, finalAddonsData) => {
        const dropOffDate = bookingData.dropOffDate ? new Date(bookingData.dropOffDate) : new Date();
        const pickupDate = bookingData.pickupDate ? new Date(bookingData.pickupDate) : new Date();

        const wasVerificationSkipped = verificationData?.verificationSkipped ?? finalAddonsData.verificationSkipped;

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
          addons: { ...finalAddonsData, verificationSkipped: wasVerificationSkipped, distanceInfo: finalAddonsData.distanceInfo, addressVerificationSkipped: finalAddonsData.addressVerificationSkipped },
          total_price: finalPrice,
          status: 'pending_payment',
          drop_off_date: dropOffDate.toISOString().split('T')[0],
          pickup_date: pickupDate.toISOString().split('T')[0],
          notes: finalAddonsData.notes,
          was_verification_skipped: wasVerificationSkipped,
          verification_notes: verificationData?.verificationNotes || null,
        };
        
        try {
          const { data, error } = await supabase
            .from('bookings')
            .insert(pendingBookingPayload)
            .select('id, customer_id')
            .single();

          if (error) throw error;
          
          if(verificationData?.licenseImageUrls?.length > 0) {
              const { error: customerUpdateError } = await supabase
                .from('customers')
                .update({
                  license_plate: verificationData.licensePlate,
                  license_image_urls: verificationData.licenseImageUrls
                })
                .eq('id', data.customer_id);

              if (customerUpdateError) throw customerUpdateError;
          }
          
          setBookingId(data.id);
          setTotalPrice(finalPrice);
          setAddonsData(finalAddonsData);
          setStep(3);

        } catch (error) {
          toast({
            title: "Booking Error",
            description: "Could not create your booking record. Please try again. " + error.message,
            variant: "destructive",
            duration: 30000,
          });
          console.error("Error creating pending booking:", error);
        }
      };

      const handleBack = () => {
        if (step > 0) {
          setStep(step - 1);
        }
      };

      const handleStepClick = (targetStep) => {
        if (targetStep < step) {
          setStep(targetStep);
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
                onBack={() => { setStep(0); setSelectedPlan(null); }}
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
        <div className="pt-8">
          {step > 0 && <StepIndicator currentStep={step} onStepClick={handleStepClick} />}
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
        </div>
      );
    }