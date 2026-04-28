import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, ArrowLeft, ArrowRight } from 'lucide-react';
import { RescheduleServiceSelectionSection } from './RescheduleServiceSelectionSection';
import { RescheduleDateTimeSelector } from './RescheduleDateTimeSelector';
import { RescheduleAddonsSection } from './RescheduleAddonsSection';
import { RescheduleAddressVerification } from './RescheduleAddressVerification';
import { RescheduleAgreementsSection } from './RescheduleAgreementsSection';
import { ReschedulePricingBreakdown } from './ReschedulePricingBreakdown';
import { RescheduleRequestReview } from './RescheduleRequestReview';
import { useRescheduleDataLoader } from '@/hooks/useRescheduleDataLoader';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { calculateAddonsDifference } from '@/utils/rescheduleCalculations';

const STEPS = {
  SERVICE: 1,
  DATETIME: 2,
  ADDONS: 3,
  ADDRESS: 4,
  AGREEMENTS: 5,
  PRICING: 6,
  REVIEW: 7
};

const STEP_TITLES = {
  [STEPS.SERVICE]: 'Select Service',
  [STEPS.DATETIME]: 'Choose Dates & Times',
  [STEPS.ADDONS]: 'Add-ons & Equipment',
  [STEPS.ADDRESS]: 'Delivery Address',
  [STEPS.AGREEMENTS]: 'Terms & Conditions',
  [STEPS.PRICING]: 'Pricing Breakdown',
  [STEPS.REVIEW]: 'Review & Submit'
};

export const RescheduleDialog = ({ open, onClose, bookingId, onSuccess }) => {
  const { data, loading, error } = useRescheduleDataLoader(bookingId);
  const [currentStep, setCurrentStep] = useState(STEPS.SERVICE);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedService, setSelectedService] = useState(null);
  const [newDropOffDate, setNewDropOffDate] = useState(null);
  const [newPickupDate, setNewPickupDate] = useState(null);
  const [newDropOffTime, setNewDropOffTime] = useState('');
  const [newPickupTime, setNewPickupTime] = useState('');
  const [selectedAddonsList, setSelectedAddonsList] = useState([]);
  const [originalAddonsList, setOriginalAddonsList] = useState([]);
  const [verifiedAddress, setVerifiedAddress] = useState(null);
  const [distanceMiles, setDistanceMiles] = useState(0);
  const [isManualAddress, setIsManualAddress] = useState(false);
  const [addressVerificationError, setAddressVerificationError] = useState(false);
  
  // Agreements state with correct keys matching the component
  const [agreementsAccepted, setAgreementsAccepted] = useState({
    terms: false,
    charges: false,
    release: false
  });
  
  const [comments, setComments] = useState('');

  useEffect(() => {
    if (data) {
      setSelectedService(data.originalService);
      setOriginalAddonsList(data.originalAddonsList || []);
      setSelectedAddonsList(data.originalAddonsList || []);
      
      // Initialize address with original booking address
      const originalAddress = data.originalBooking?.delivery_address || data.originalBooking?.contact_address;
      if (originalAddress) {
        setVerifiedAddress(originalAddress.formatted_address || `${originalAddress.street}, ${originalAddress.city}, ${originalAddress.state} ${originalAddress.zip}`);
        setDistanceMiles(data.originalBooking?.customers?.distance_miles || 0);
      }
    }
  }, [data]);

  // Callback to handle service selection
  const handleServiceSelect = useCallback((service) => {
    if (!service) {
      console.warn('RescheduleDialog: handleServiceSelect called with no service data');
      return;
    }
    
    setSelectedService(service);
    
    toast({
      title: "Service Selected",
      description: `You've selected ${service.name}. Continue to the next step.`,
    });
  }, []);

  // Callback to handle address updates from RescheduleAddressVerification
  const handleAddressUpdated = useCallback((addressString, verificationData) => {
    if (!addressString || !verificationData) {
      setVerifiedAddress(null);
      setDistanceMiles(0);
      setAddressVerificationError(true);
      setIsManualAddress(false);
      return;
    }

    // Update state with verified address data
    setVerifiedAddress(addressString);
    setDistanceMiles(verificationData.distance || 0);
    setIsManualAddress(verificationData.isManualEntry || false);
    setAddressVerificationError(verificationData.error || false);
  }, []);

  const handleNext = () => {
    // Validate current step before proceeding
    if (currentStep === STEPS.SERVICE && !selectedService) {
      toast({ title: "Service Required", description: "Please select a service plan.", variant: "destructive" });
      return;
    }
    
    if (currentStep === STEPS.DATETIME) {
      if (!newDropOffDate || !newDropOffTime) {
        toast({ title: "Date/Time Required", description: "Please select start date and time.", variant: "destructive" });
        return;
      }
      if (selectedService?.id !== 3 && (!newPickupDate || !newPickupTime)) {
        toast({ title: "End Date/Time Required", description: "Please select end date and time.", variant: "destructive" });
        return;
      }
    }

    if (currentStep === STEPS.ADDRESS) {
      const requiresDelivery = selectedService?.id === 1 || selectedService?.id === 4 || selectedService?.id === 3;
      
      if (requiresDelivery) {
        if (!verifiedAddress || addressVerificationError) {
          toast({ 
            title: "Address Verification Required", 
            description: "Please verify your delivery address before continuing.", 
            variant: "destructive" 
          });
          return;
        }
      } else {
        // Skip to agreements if delivery not required
        setCurrentStep(STEPS.AGREEMENTS);
        return;
      }
    }

    if (currentStep === STEPS.AGREEMENTS) {
      // Validate all required agreements are checked (using correct keys)
      if (!agreementsAccepted.terms || !agreementsAccepted.charges || !agreementsAccepted.release) {
        console.log('Agreement validation failed:', agreementsAccepted);
        toast({ 
          title: "Agreements Required", 
          description: "You must accept all terms and conditions to continue.", 
          variant: "destructive" 
        });
        return;
      }
      console.log('All agreements accepted:', agreementsAccepted);
    }

    setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    const requiresDelivery = selectedService?.id === 1 || selectedService?.id === 4 || selectedService?.id === 3;
    
    // Skip address step when going back if not delivery service
    if (currentStep === STEPS.AGREEMENTS && !requiresDelivery) {
      setCurrentStep(STEPS.ADDONS);
      return;
    }
    
    setCurrentStep(prev => prev - 1);
  };

  const handleSubmit = async () => {
    // Final validation before submission
    if (!agreementsAccepted.terms || !agreementsAccepted.charges || !agreementsAccepted.release) {
      toast({ 
        title: "Agreements Required", 
        description: "All agreements must be accepted before submitting.", 
        variant: "destructive" 
      });
      return;
    }

    setSubmitting(true);
    
    try {
      console.log('Starting reschedule submission...');
      console.log('Original add-ons:', originalAddonsList);
      console.log('New add-ons:', selectedAddonsList);

      // Calculate inventory differences
      const { toReturn, toAllocate, unchanged } = calculateAddonsDifference(
        originalAddonsList,
        selectedAddonsList
      );

      console.log('Inventory changes:', { toReturn, toAllocate, unchanged });

      // Format reschedule request data
      const rescheduleData = {
        booking_id: bookingId,
        new_service_id: selectedService?.id,
        new_drop_off_date: newDropOffDate,
        new_pickup_date: newPickupDate,
        new_drop_off_time: newDropOffTime,
        new_pickup_time: newPickupTime,
        original_addons: originalAddonsList,
        new_addons: selectedAddonsList,
        inventory_changes: {
          to_return: toReturn,
          to_allocate: toAllocate,
          unchanged: unchanged
        },
        new_delivery_address: verifiedAddress,
        distance_miles: distanceMiles,
        is_manual_address: isManualAddress,
        customer_comments: comments,
        agreements_accepted: agreementsAccepted,
        request_timestamp: new Date().toISOString()
      };

      console.log('Submitting reschedule data:', rescheduleData);

      // Submit reschedule request (backend will handle inventory changes)
      const { data: requestData, error: requestError } = await supabase.functions.invoke('request-booking-change', {
        body: rescheduleData
      });

      if (requestError) throw requestError;

      console.log('Reschedule request successful:', requestData);

      toast({
        title: "Reschedule Request Submitted!",
        description: "Your request has been submitted for admin review. Inventory changes will be processed upon approval.",
      });

      onSuccess?.();
      onClose();
      
    } catch (err) {
      console.error('Error submitting reschedule:', err);
      toast({
        title: "Submission Failed",
        description: err.message || "Could not submit reschedule request. Please try again.",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-gray-950 text-white border-gray-800">
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-12 h-12 animate-spin text-gold mb-4" />
            <p className="text-gray-400">Loading booking details...</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (error || !data) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl bg-gray-950 text-white border-gray-800">
          <DialogHeader>
            <DialogTitle className="text-red-400">Error Loading Booking</DialogTitle>
          </DialogHeader>
          <p className="text-gray-400">{error || 'Could not load booking data.'}</p>
          <Button onClick={onClose} variant="outline">Close</Button>
        </DialogContent>
      </Dialog>
    );
  }

  const requiresDelivery = selectedService?.id === 1 || selectedService?.id === 4 || selectedService?.id === 3;
  const showAddressStep = requiresDelivery;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-gray-950 text-white border-gray-800">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-gold flex items-center">
            <span className="mr-3">Reschedule Booking #{bookingId}</span>
            {currentStep < STEPS.REVIEW && (
              <span className="text-sm text-gray-400 font-normal">
                Step {currentStep} of 7: {STEP_TITLES[currentStep]}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="py-6">
          {currentStep === STEPS.SERVICE && (
            <RescheduleServiceSelectionSection
              availableServices={data.availableServices}
              selectedService={selectedService}
              onSelectService={handleServiceSelect}
              currentServiceId={data.originalService?.id}
            />
          )}

          {currentStep === STEPS.DATETIME && (
            <RescheduleDateTimeSelector
              booking={data.originalBooking}
              availableDates={data.availableDates}
              newDropOffDate={newDropOffDate}
              setNewDropOffDate={setNewDropOffDate}
              newPickupDate={newPickupDate}
              setNewPickupDate={setNewPickupDate}
              newDropOffTime={newDropOffTime}
              setNewDropOffTime={setNewDropOffTime}
              newPickupTime={newPickupTime}
              setNewPickupTime={setNewPickupTime}
              selectedService={selectedService}
            />
          )}

          {currentStep === STEPS.ADDONS && (
            <RescheduleAddonsSection
              originalBooking={data.originalBooking}
              selectedAddonsList={selectedAddonsList}
              setSelectedAddonsList={setSelectedAddonsList}
              bookingId={bookingId}
            />
          )}

          {currentStep === STEPS.ADDRESS && showAddressStep && (
            <RescheduleAddressVerification
              booking={data.originalBooking}
              newService={selectedService}
              onAddressUpdated={handleAddressUpdated}
            />
          )}

          {currentStep === STEPS.AGREEMENTS && (
            <RescheduleAgreementsSection
              agreementsAccepted={agreementsAccepted}
              setAgreementsAccepted={setAgreementsAccepted}
              comments={comments}
              setComments={setComments}
              booking={data.originalBooking}
            />
          )}

          {currentStep === STEPS.PRICING && (
            <ReschedulePricingBreakdown
              bookingId={bookingId}
              originalService={data.originalService}
              originalAddonsList={originalAddonsList}
              originalCosts={data.originalCosts}
              newService={selectedService}
              newAddonsList={selectedAddonsList}
              newDropOffDate={newDropOffDate}
              newPickupDate={newPickupDate}
              distanceMiles={distanceMiles}
              isManualAddress={isManualAddress}
            />
          )}

          {currentStep === STEPS.REVIEW && (
            <RescheduleRequestReview
              bookingId={bookingId}
              originalBooking={data.originalBooking}
              originalService={data.originalService}
              newService={selectedService}
              newDropOffDate={newDropOffDate}
              newPickupDate={newPickupDate}
              newDropOffTime={newDropOffTime}
              newPickupTime={newPickupTime}
              selectedAddonsList={selectedAddonsList}
              deliveryAddress={verifiedAddress}
              comments={comments}
            />
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex justify-between items-center pt-6 border-t border-gray-800">
          {currentStep > STEPS.SERVICE ? (
            <Button onClick={handleBack} variant="outline" disabled={submitting}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
          ) : (
            <Button onClick={onClose} variant="outline">Cancel</Button>
          )}

          {currentStep < STEPS.REVIEW ? (
            <Button onClick={handleNext} className="bg-gold hover:bg-gold-light text-black">
              Next <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting} className="bg-green-600 hover:bg-green-700">
              {submitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...</>
              ) : (
                <><CheckCircle2 className="mr-2 h-4 w-4" /> Submit Request</>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};