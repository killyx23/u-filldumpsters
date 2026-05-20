
import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, CreditCard, Lock, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from '@/components/ui/use-toast';
import { format, isValid, parseISO } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/customSupabaseClient';
import { DeliveryLocationMap } from '@/components/DeliveryLocationMap';
import { useBookingTaxOptions } from '@/hooks/useBookingTaxOptions';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';
import { formatTimeWindow } from '@/utils/timeWindowFormatter';
import { getServiceSpecificDateLabel, isSelfServiceTrailer } from '@/utils/serviceSpecificLabels';
import { getFormattedServiceTimes } from '@/utils/serviceAvailabilityHelper';
import { useTaxRate } from '@/utils/getTaxRate';
import { calculateBookingTotal } from '@/utils/calculateBookingTotal';

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise =
  typeof stripePublishableKey === 'string' && stripePublishableKey.trim()
    ? loadStripe(stripePublishableKey)
    : null;

const formatMoney = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount ?? 0);

const ConfirmationLine = ({ label, value }) => (
  <div className="flex justify-between items-start py-1.5 border-b border-white/5 last:border-0">
    <p className="font-medium text-blue-200/80 w-1/3 pr-2">{label}:</p>
    <p className="text-right w-2/3 text-white font-medium whitespace-pre-line">{value ?? 'N/A'}</p>
  </div>
);

const BreakdownLine = ({ label, value, icon = null }) => (
  <div className="flex justify-between items-center py-1">
    <span className="flex items-center">
      {icon && <span className="mr-2">{icon}</span>}
      {label}
    </span>
    <span>{formatMoney(value)}</span>
  </div>
);

const CategoryHeader = ({ icon, title }) => (
  <div className="flex items-center text-yellow-400 font-bold text-sm mt-4 mb-2 pb-1 border-b border-white/20">
    <span className="text-lg mr-2">{icon}</span>
    <span>{title}</span>
  </div>
);

const CheckoutForm = ({ 
  onBack,
  bookingId,
  bookingData,
  plan,
  addonsData,
  deliveryService,
  validatedTotal,
  pricingBreakdown,
  availabilityTimes
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();

  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [delivery_location_verified, setDeliveryLocation_Verified] = useState(false);
  const [formError, setFormError] = useState(null);
  const [isPaymentElementReady, setIsPaymentElementReady] = useState(false);
  
  const isDelivery = plan?.id === 2 && deliveryService;
  const currentPlan = isDelivery ? { ...plan, name: "Dump Loader Trailer with Delivery" } : (plan || {});
  
  const isDeliveryService = plan?.id === 1 || plan?.id === 4 || (plan?.id === 2 && deliveryService);

  const firstName = bookingData?.firstName || bookingData?.first_name || '';
  const lastName = bookingData?.lastName || bookingData?.last_name || '';
  const customerFullName = `${firstName} ${lastName}`.trim() || bookingData?.name || 'N/A';

  const contactAddress = bookingData?.contactAddress;
  const deliveryAddress = addonsData?.deliveryAddress;
  const addressToUse = (deliveryAddress?.street ? deliveryAddress : null) || contactAddress || {};

  const formatDate = (date) => {
    if (!date) return 'N/A';
    try {
      const parsedDate = date instanceof Date ? date : parseISO(date.toString());
      if (!isValid(parsedDate)) return "Invalid Date";
      return format(parsedDate, 'PPP');
    } catch (e) { return "Invalid Date"; }
  };

  const canProceedWithPayment = isConfirmed && stripe && elements && isPaymentElementReady && (!isDeliveryService || delivery_location_verified) && validatedTotal > 0;

  const handlePayment = async (e) => {
    e.preventDefault();
    setFormError(null);

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [PaymentPage] Payment submission started...`);

    if (!stripe || !elements) {
      setFormError("Stripe is still initializing. Please wait a moment and try again.");
      return;
    }
    if (!isConfirmed) {
      toast({ title: "Confirmation Required", description: "Please confirm your details are correct before paying.", variant: "destructive" });
      return;
    }
    if (isDeliveryService && !delivery_location_verified) {
      toast({ title: "Location Verification Required", description: "Please verify the delivery location map to continue.", variant: "destructive" });
      return;
    }
    if (!isPaymentElementReady) {
      setFormError("Payment form is not ready yet. Please wait.");
      return;
    }
    if (validatedTotal <= 0) {
      setFormError("Invalid payment amount. Please refresh and try again.");
      return;
    }

    setIsProcessing(true);

    try {
      if (isDeliveryService && delivery_location_verified) {
        console.log(`[${timestamp}] [PaymentPage] Updating delivery location verification...`);
        await supabase.from('bookings').update({ 
          delivery_location_verified: true, 
          delivery_location_verified_at: new Date().toISOString() 
        }).eq('id', bookingId);
      }

      console.log(`[${timestamp}] [PaymentPage] Confirming payment with Stripe...`);

      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          payment_method_data: {
            billing_details: {
              name: customerFullName,
              email: bookingData?.email || '',
              phone: bookingData?.phone || '',
              address: {
                line1: addressToUse?.street || '',
                city: addressToUse?.city || '',
                state: addressToUse?.state || '',
                postal_code: addressToUse?.zip || '',
                country: 'US',
              }
            }
          }
        },
        redirect: 'if_required',
      });

      if (stripeError) {
        console.error(`[${timestamp}] [PaymentPage] Stripe error:`, stripeError);
        setFormError(stripeError.message || "An unexpected error occurred processing your payment.");
        toast({ 
          title: "Payment Failed", 
          description: stripeError.message || "An unexpected error occurred.", 
          variant: "destructive" 
        });
        setIsProcessing(false);
        return;
      }

      console.log(`[${timestamp}] [PaymentPage] ✅ Payment succeeded! Redirecting...`);
      
      const confirmationUrl = `${window.location.origin}/confirmation?booking_id=${bookingId}&payment_intent=${paymentIntent?.id}`;
      
      setTimeout(() => {
        window.location.href = confirmationUrl;
      }, 1500);

    } catch (err) {
      console.error(`[${new Date().toISOString()}] [PaymentPage] Unexpected error:`, err);
      setIsProcessing(false);
      setFormError("An error occurred during payment processing.");
      toast({
        title: 'Payment Error',
        description: err.message || 'An unexpected error occurred.',
        variant: 'destructive'
      });
    }
  };

  const handleAddressCorrection = () => {
    navigate('/book');
  };

  // Service-specific labels
  const isSelfService = isSelfServiceTrailer(plan, isDelivery);
  const dropoffLabel = getServiceSpecificDateLabel(plan, isDelivery, 'dropoff');
  const pickupLabel = getServiceSpecificDateLabel(plan, isDelivery, 'pickup');

  const timeOptions = {
    isWindow: isDeliveryService,
    isSelfService: isSelfService,
    serviceType: plan?.service_type
  };

  const getDisplayTime = (timeSlot, isDropOff) => {
    if (plan?.id === 2 && !deliveryService) {
      return isDropOff ? availabilityTimes.pickupStartTime : availabilityTimes.returnByTime;
    }
    return formatTimeWindow(timeSlot, timeOptions);
  };

  const formatConfirmationValue = (date, timeSlot, isDropOff, label) => {
    const formattedDate = formatDate(date);
    const time = getDisplayTime(timeSlot, isDropOff);
    
    if (isSelfService) {
      const timeLabel = isDropOff ? 'Pickup Start Time' : 'Return by Time';
      return `${formattedDate}\n${timeLabel}: ${time}`;
    } else {
      return `${formattedDate} ${isDeliveryService ? 'at' : 'by'} ${time}`;
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-slate-900/60 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
      <div className="flex items-center mb-8">
        <Button 
          onClick={() => onBack ? onBack() : navigate(-1)} 
          variant="ghost" 
          size="icon" 
          className="mr-4 text-white hover:bg-white/20" 
          disabled={isProcessing}
        >
          <ArrowLeft />
        </Button>
        <h2 className="text-3xl font-bold text-white">Secure Payment</h2>
      </div>

      <div className="bg-white/5 p-6 rounded-lg mb-8 border border-white/10">
        <h3 className="text-2xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2">Order Summary</h3>
        <div className="space-y-1 text-white">
          <ConfirmationLine label="Service" value={currentPlan?.name} />
          <ConfirmationLine label="Customer" value={customerFullName} />
          <ConfirmationLine label="Email" value={bookingData?.email} />
          <ConfirmationLine 
            label="Address" 
            value={addressToUse?.street ? `${addressToUse.street}, ${addressToUse.city}, ${addressToUse.state} ${addressToUse.zip}` : 'N/A'} 
          />
          <ConfirmationLine 
            label={dropoffLabel} 
            value={formatConfirmationValue(bookingData?.dropOffDate, bookingData?.dropOffTimeSlot, true, dropoffLabel)} 
          />
          <ConfirmationLine 
            label={pickupLabel} 
            value={formatConfirmationValue(bookingData?.pickupDate, bookingData?.pickupTimeSlot, false, pickupLabel)} 
          />
        </div>
      </div>

      {isDeliveryService && (
        <>
          <DeliveryLocationMap 
            deliveryAddress={addressToUse} 
            isVerified={delivery_location_verified} 
            onVerificationChange={setDeliveryLocation_Verified} 
          />
          <div className="mb-8 flex justify-center">
            <Button 
              onClick={handleAddressCorrection}
              variant="outline"
              className="text-orange-400 border-orange-500/50 hover:bg-orange-500/10 hover:border-orange-500"
            >
              This is incorrect - Go back to edit address
            </Button>
          </div>
        </>
      )}

      <div className="bg-white/5 p-6 rounded-lg mb-8 border border-white/10">
        <h4 className="text-2xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2">Charges Breakdown</h4>
        
        <div className="space-y-1 text-blue-100 font-mono text-sm">
          <CategoryHeader icon="📦" title="Service Costs" />
          <BreakdownLine label="Base Rental Price" value={pricingBreakdown.basePriceAmount} />
          {pricingBreakdown.deliveryFeeFlat > 0 && <BreakdownLine label="Base Delivery Fee" value={pricingBreakdown.deliveryFeeFlat} />}
          {pricingBreakdown.tripMileageCost > 0 && <BreakdownLine label="Mileage Charge" value={pricingBreakdown.tripMileageCost} />}
          
          {(pricingBreakdown.insuranceCost > 0 || pricingBreakdown.drivewayProtectionCost > 0) && (
            <>
              <CategoryHeader icon="🛡️" title="Protection Options" />
              {pricingBreakdown.insuranceCost > 0 && <BreakdownLine label="Rental Insurance" value={pricingBreakdown.insuranceCost} />}
              {pricingBreakdown.drivewayProtectionCost > 0 && <BreakdownLine label="Driveway Protection" value={pricingBreakdown.drivewayProtectionCost} />}
            </>
          )}
          
          {pricingBreakdown.rentEquipmentCost > 0 && (
            <>
              <CategoryHeader icon="🚚" title="Rent Equipment" />
              <BreakdownLine label="Equipment Rentals" value={pricingBreakdown.rentEquipmentCost} />
            </>
          )}
          
          {pricingBreakdown.purchaseItemsCost > 0 && (
            <>
              <CategoryHeader icon="🛒" title="Items for Purchase" />
              <BreakdownLine label="Purchase Items" value={pricingBreakdown.purchaseItemsCost} />
            </>
          )}
          
          {pricingBreakdown.disposalCost > 0 && (
            <>
              <CategoryHeader icon="♻️" title="Disposal Items" />
              <BreakdownLine label="Special Disposal Fees" value={pricingBreakdown.disposalCost} />
            </>
          )}
          
          {pricingBreakdown.discount > 0 && (
            <>
              <CategoryHeader icon="🏷️" title="Discounts" />
              <BreakdownLine 
                label={`Coupon (${addonsData?.coupon?.code || 'Applied'})`} 
                value={-pricingBreakdown.discount} 
              />
            </>
          )}
          
          <div className="border-t border-white/20 my-3 pt-3">
            <BreakdownLine label="Subtotal" value={pricingBreakdown.subtotal} />
            <BreakdownLine label={`Tax (${pricingBreakdown.taxRate.toFixed(2)}%)`} value={pricingBreakdown.tax} />
          </div>
          <div className="border-t border-white/20 pt-3 mt-1">
            <div className="flex justify-between items-center text-white">
              <span className="text-lg font-bold">Total Amount:</span>
              <span className="text-2xl font-bold text-green-400">{formatMoney(validatedTotal)}</span>
            </div>
          </div>
          
          {isDeliveryService && (
            <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3 mt-4">
              <div className="flex items-start">
                <span className="text-xl mr-2">🏗️</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-yellow-400">Landfill/Disposal Fees (TBD)</p>
                  <p className="text-xs text-yellow-200 mt-1">Pending dump fees will be calculated based on actual waste processed</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handlePayment}>
        <div className="mb-6">
          <PaymentElement 
            onReady={() => setIsPaymentElementReady(true)} 
            options={{ 
              layout: 'tabs', 
              fields: { 
                billingDetails: { 
                  name: 'never', 
                  email: 'never', 
                  phone: 'never', 
                  address: 'never' 
                } 
              } 
            }} 
          />
        </div>
        
        {formError && (
          <div className="mb-6 flex items-start text-red-400 text-sm bg-red-950/40 p-3 rounded border border-red-500/30">
            <span className="mr-2 flex-shrink-0">⚠</span>
            <p>{formError}</p>
          </div>
        )}
        
        <div className="flex items-center space-x-3 mb-6 bg-white/5 p-4 rounded-lg border border-white/10">
          <Checkbox 
            id="confirm-details" 
            checked={isConfirmed} 
            onCheckedChange={setIsConfirmed} 
            disabled={isProcessing} 
            className="border-white/50 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500" 
          />
          <Label 
            htmlFor="confirm-details" 
            className="text-sm text-blue-100 leading-snug cursor-pointer select-none"
          >
            I have reviewed all the information above and confirm it is correct.
          </Label>
        </div>
        
        {!canProceedWithPayment && !isProcessing && isDeliveryService && !delivery_location_verified && (
          <div className="mb-4 text-center text-orange-400 text-sm font-medium bg-orange-950/30 py-2 rounded border border-orange-500/30">
            Please verify delivery location to continue
          </div>
        )}
        
        <Button 
          type="submit" 
          disabled={isProcessing || !canProceedWithPayment} 
          className={`w-full py-6 text-xl font-bold transition-all duration-300 ${
            isProcessing || !canProceedWithPayment 
              ? 'bg-white/10 text-white/50 cursor-not-allowed border border-white/10' 
              : 'bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white shadow-xl shadow-green-900/40 border border-green-400/30 active:scale-[0.98]'
          }`}
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-3 h-6 w-6 animate-spin" />
              Processing Payment...
            </>
          ) : (
            <>
              <CreditCard className="mr-3 h-6 w-6" />
              Pay {formatMoney(validatedTotal)}
            </>
          )}
        </Button>
        
        <p className="text-xs text-gray-400 mt-4 flex items-center justify-center">
          <Lock className="h-3 w-3 mr-1.5 text-blue-400" /> 
          Secure 256-bit SSL Encrypted Payment
        </p>
      </form>
    </div>
  );
};

export const PaymentPage = ({ onBack }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [equipmentPrices, setEquipmentPrices] = useState({});
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [availabilityTimes, setAvailabilityTimes] = useState({
    pickupStartTime: 'Time not specified',
    returnByTime: 'Time not specified'
  });
  const [clientSecret, setClientSecret] = useState(null);
  const [bookingId, setBookingId] = useState(null);
  const [bookingCreated, setBookingCreated] = useState(false);
  
  // Retrieved booking data from pending_customers
  const [pendingCustomerData, setPendingCustomerData] = useState(null);
  const [bookingData, setBookingData] = useState(null);
  const [plan, setPlan] = useState(null);
  const [addonsData, setAddonsData] = useState(null);
  const [deliveryService, setDeliveryService] = useState(false);
  const [loadingBookingData, setLoadingBookingData] = useState(true);
  const [dataError, setDataError] = useState(null);
  
  const [validatedTotal, setValidatedTotal] = useState(0);

  const { taxRate, loading: loadingTaxRate } = useTaxRate();
  const { insurancePrice, taxOptions, loading: loadingTaxOptions } = useBookingTaxOptions(plan?.id);

  // Load equipment prices
  useEffect(() => {
    const loadPrices = async () => {
      setLoadingPrices(true);
      const prices = {};
      
      try {
        for (let id = 1; id <= 7; id++) {
          if (isValidEquipmentId(id)) {
            prices[id] = await getPriceForEquipment(id);
          }
        }
        setEquipmentPrices(prices);
      } catch (error) {
        console.error('[PaymentPage] Error loading equipment prices:', error);
        prices[1] = 10;
        prices[2] = 15;
        prices[3] = 5;
        prices[4] = 25;
        prices[5] = 15;
        prices[6] = 35;
        prices[7] = 20;
        setEquipmentPrices(prices);
      } finally {
        setLoadingPrices(false);
      }
    };

    loadPrices();
  }, []);

  // Retrieve booking data from pending_customers using URL parameter
  useEffect(() => {
    const retrieveBookingData = async () => {
      const pendingId = searchParams.get('bookingId');
      
      if (!pendingId) {
        setDataError('Missing booking ID. Cannot retrieve your booking data.');
        setLoadingBookingData(false);
        return;
      }

      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [PaymentPage] Retrieving booking data for ID: ${pendingId}`);

      try {
        const { data, error } = await supabase
          .from('pending_customers')
          .select('*')
          .eq('id', pendingId)
          .single();

        if (error) {
          console.error(`[${timestamp}] [PaymentPage] Error fetching pending customer:`, error);
          throw new Error('Could not find your booking. Please restart the booking process.');
        }

        if (!data) {
          throw new Error('Booking not found. Please restart the booking process.');
        }

        console.log(`[${timestamp}] [PaymentPage] ✓ Retrieved pending customer data:`, data);

        // Reconstruct booking data from pending_customers
        const retrievedBookingData = {
          firstName: data.first_name || '',
          lastName: data.last_name || '',
          email: data.email || '',
          phone: data.phone || '',
          contactAddress: data.contact_address || { 
            street: data.street, 
            city: data.city, 
            state: data.state, 
            zip: data.zip 
          },
          dropOffDate: data.drop_off_date,
          pickupDate: data.pickup_date,
          dropOffTimeSlot: data.drop_off_time_slot || '',
          pickupTimeSlot: data.pickup_time_slot || '',
          notes: data.notes || '',
          ...data.booking_data
        };

        setPendingCustomerData(data);
        setBookingData(retrievedBookingData);
        setPlan(data.plan_data);
        setAddonsData(data.addons_data || {});
        setDeliveryService(data.delivery_service || false);

      } catch (error) {
        console.error(`[${timestamp}] [PaymentPage] Failed to retrieve booking:`, error);
        setDataError(error.message);
      } finally {
        setLoadingBookingData(false);
      }
    };

    retrieveBookingData();
  }, [searchParams]);

  // Create actual booking from pending_customers data once pricing is loaded
  useEffect(() => {
    if (loadingBookingData || loadingPrices || loadingTaxRate || loadingTaxOptions || bookingCreated) return;
    if (!pendingCustomerData) return;

    const createActualBooking = async (retrievedBookingData, pendingData, validatedTotalAmount, calcResult) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [PaymentPage] Creating actual booking from pending customer data with total $${validatedTotalAmount}...`);

      try {
        const fullName = `${retrievedBookingData.firstName} ${retrievedBookingData.lastName}`.trim();
        const isUnverifiedDelivery = pendingData.delivery_address && 
                                     !pendingData.delivery_address.isVerified;

        const bookingPayload = {
          name: fullName,
          first_name: retrievedBookingData.firstName,
          last_name: retrievedBookingData.lastName,
          email: retrievedBookingData.email,
          phone: retrievedBookingData.phone,
          street: pendingData.contact_address?.street || pendingData.street,
          city: pendingData.contact_address?.city || pendingData.city,
          state: pendingData.contact_address?.state || pendingData.state,
          zip: pendingData.contact_address?.zip || pendingData.zip,
          contact_address: pendingData.contact_address,
          delivery_address: pendingData.delivery_address || pendingData.contact_address,
          notes: pendingData.notes,
          drop_off_date: pendingData.drop_off_date,
          pickup_date: pendingData.pickup_date,
          drop_off_time_slot: pendingData.drop_off_time_slot,
          pickup_time_slot: pendingData.pickup_time_slot,
          plan: pendingData.plan_data,
          total_price: validatedTotalAmount,
          subtotal_before_tax: calcResult.subtotal,
          tax_amount: calcResult.tax,
          tax_rate_used: calcResult.taxRate,
          status: 'pending_payment',
          was_verification_skipped: isUnverifiedDelivery,
          verification_notes: pendingData.addons_data?.verificationNotes || null,
          addons: {
            ...pendingData.addons_data,
            isDelivery: pendingData.delivery_service,
          },
        };

        console.log(`[${timestamp}] [PaymentPage] Calling create_pending_booking RPC...`);

        const { data, error } = await supabase.rpc('create_pending_booking', { 
          payload: bookingPayload 
        });

        if (error) {
          console.error(`[${timestamp}] [PaymentPage] RPC error:`, error);
          throw error;
        }

        if (!data || !data.id) {
          console.error(`[${timestamp}] [PaymentPage] RPC succeeded but no ID returned:`, data);
          throw new Error('Booking creation succeeded but ID was not returned.');
        }

        console.log(`[${timestamp}] [PaymentPage] ✓ Booking created with ID: ${data.id}`);
        setBookingId(data.id);

        // Handle license images if present
        if (pendingData.addons_data?.licenseImageUrls?.length > 0) {
          console.log(`[${timestamp}] [PaymentPage] Updating customer with license info...`);
          await supabase
            .from('customers')
            .update({
              license_plate: pendingData.addons_data.licensePlate,
              license_image_urls: pendingData.addons_data.licenseImageUrls,
            })
            .eq('id', data.customer_id);
        }

        // Decrement equipment quantities if needed
        if (pendingData.addons_data?.equipment?.length > 0) {
          console.log(`[${timestamp}] [PaymentPage] Decrementing equipment quantities...`);
          const equipmentToDecrement = pendingData.addons_data.equipment.map(item => ({
            equipment_id: item.dbId || item.equipment_id,
            quantity: item.quantity,
          }));
          await supabase.rpc('decrement_equipment_quantities', {
            items_to_decrement: equipmentToDecrement,
          });
        }

      } catch (error) {
        console.error(`[${timestamp}] [PaymentPage] Failed to create booking:`, error);
        throw error;
      }
    };

    const createBooking = async () => {
      const timestamp = new Date().toISOString();
      try {
        console.log(`[${timestamp}] [PaymentPage] Validating pricing before booking creation...`);
        
        // Calculate expected total with all up-to-date prices
        const calcResult = calculateBookingTotal(
          plan,
          addonsData,
          equipmentPrices,
          taxRate,
          deliveryService,
          insurancePrice,
          taxOptions
        );
        
        // Prefer stored total if it exists and is valid
        let finalTotal = parseFloat(pendingCustomerData.total_price);
        if (!Number.isFinite(finalTotal) || finalTotal <= 0) {
          finalTotal = calcResult.total;
        }

        // Final validation
        if (!Number.isFinite(finalTotal) || finalTotal <= 0) {
          throw new Error('Calculated total is invalid. Cannot create booking. Please check your selections and try again.');
        }

        setValidatedTotal(finalTotal);
        
        await createActualBooking(bookingData, pendingCustomerData, finalTotal, calcResult);
        setBookingCreated(true);
      } catch (err) {
        console.error(`[${timestamp}] [PaymentPage] Pricing validation/booking creation failed:`, err);
        setDataError(err.message);
      }
    };
    
    createBooking();
  }, [loadingBookingData, loadingPrices, loadingTaxRate, loadingTaxOptions, bookingCreated, pendingCustomerData, plan, addonsData, equipmentPrices, taxRate, deliveryService, insurancePrice, taxOptions, bookingData]);

  // Load availability times for self-service
  useEffect(() => {
    const loadAvailabilityTimes = async () => {
      if (plan?.id === 2 && !deliveryService && bookingData?.dropOffDate) {
        try {
          const dropOffTimes = await getFormattedServiceTimes(2, bookingData.dropOffDate);
          const pickupTimes = bookingData.pickupDate 
            ? await getFormattedServiceTimes(2, bookingData.pickupDate)
            : dropOffTimes;

          setAvailabilityTimes({
            pickupStartTime: dropOffTimes.pickupStartTime,
            returnByTime: pickupTimes.returnByTime
          });
        } catch (error) {
          console.error('[PaymentPage] Error loading availability times:', error);
        }
      }
    };

    loadAvailabilityTimes();
  }, [plan?.id, deliveryService, bookingData?.dropOffDate, bookingData?.pickupDate]);

  // Initialize payment intent once booking is created
  useEffect(() => {
    if (!bookingId || !bookingCreated) return;

    const initPaymentIntent = async () => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [PaymentPage] Initializing payment intent for booking ${bookingId}...`);

      try {
        const payload = { booking_id: bookingId };
        const { data, error: invokeError } = await supabase.functions.invoke('create-payment-intent', { 
          body: payload 
        });

        if (invokeError) throw invokeError;
        if (data?.error) throw new Error(data.error);

        const secret = data?.clientSecret || data?.client_secret;
        if (!secret) {
          throw new Error('Invalid response from server: missing payment parameters.');
        }

        console.log(`[${timestamp}] [PaymentPage] ✓ Payment intent created successfully`);
        setClientSecret(secret);
      } catch (err) {
        console.error(`[${timestamp}] [PaymentPage] Payment intent error:`, err);
        let errorMessage = 'Failed to initialize payment gateway. Please try again later.';
        if (err.message && !err.message.includes('Failed to fetch')) {
          errorMessage = `Payment Setup Error: ${err.message}`;
        }
        setDataError(errorMessage);
        toast({ 
          title: 'Payment Error', 
          description: errorMessage, 
          variant: 'destructive' 
        });
      }
    };

    initPaymentIntent();
  }, [bookingId, bookingCreated]);

  if (!stripePromise) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto bg-red-900/40 border border-red-500/50 p-4 rounded-lg text-red-200 font-semibold flex items-center shadow-lg">
          <AlertTriangle className="h-6 w-6 mr-3 flex-shrink-0 text-red-400" />
          <p>Payment configuration is missing. Please check your Stripe configuration.</p>
        </div>
      </div>
    );
  }

  // Error state - booking data not found or failed initialization
  if (!loadingBookingData && dataError) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-2xl mx-auto bg-red-900/40 border border-red-500/50 p-8 rounded-lg shadow-lg">
          <div className="flex items-center text-red-200 font-bold text-2xl mb-6">
            <AlertTriangle className="h-10 w-10 mr-3 text-red-400" />
            Booking Creation Failed
          </div>
          <p className="text-red-100 mb-8 text-lg">
            {dataError}
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Button 
              onClick={() => navigate('/')} 
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              Start New Booking
            </Button>
            <Button 
              onClick={() => onBack ? onBack() : navigate(-1)} 
              variant="outline" 
              className="flex-1 text-white hover:bg-white/10"
            >
              Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Loading states
  if (loadingBookingData || loadingPrices || loadingTaxRate || loadingTaxOptions || !bookingData || !bookingCreated) {
    return (
      <div className="flex flex-col justify-center items-center h-96 text-white">
        <Loader2 className="h-16 w-16 animate-spin text-yellow-400 mb-4" />
        <span className="text-xl font-medium">Validating your booking details...</span>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="flex flex-col justify-center items-center h-96 text-white">
        <Loader2 className="h-16 w-16 animate-spin text-yellow-400 mb-4" />
        <span className="text-xl font-medium">Preparing Secure Payment...</span>
        <p className="text-gray-400 mt-2">Connecting to payment gateway. Please wait.</p>
      </div>
    );
  }

  const elementsOptions = {
    clientSecret,
    appearance: {
      theme: 'night',
      variables: { 
        colorPrimary: '#facc15', 
        colorBackground: '#1e293b', 
        colorText: '#f1f5f9', 
        colorDanger: '#ef4444', 
        fontFamily: '"Inter", system-ui, sans-serif', 
        borderRadius: '8px' 
      },
      rules: { 
        '.Input': { 
          backgroundColor: '#0f172a', 
          border: '1px solid rgba(255,255,255,0.15)' 
        }, 
        '.Input:focus': { 
          border: '1px solid #facc15', 
          boxShadow: '0 0 0 2px rgba(250,204,21,0.2)' 
        }, 
        '.Label': { 
          color: '#94a3b8' 
        } 
      }
    }
  };

  const pricingBreakdown = calculateBookingTotal(
    plan,
    addonsData,
    equipmentPrices,
    taxRate,
    deliveryService,
    insurancePrice,
    taxOptions
  );

  return (
    <motion.div 
      initial={{ opacity: 0, x: 100 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -100 }} 
      transition={{ duration: 0.5 }} 
      className="container mx-auto py-16 px-4"
    >
      <Elements stripe={stripePromise} options={elementsOptions}>
        <CheckoutForm 
          onBack={onBack}
          bookingId={bookingId}
          bookingData={bookingData}
          plan={plan}
          addonsData={addonsData}
          deliveryService={deliveryService}
          validatedTotal={validatedTotal}
          pricingBreakdown={pricingBreakdown}
          availabilityTimes={availabilityTimes}
        />
      </Elements>
    </motion.div>
  );
};
