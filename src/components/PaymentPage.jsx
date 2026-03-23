
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CreditCard, Lock, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStripe, useElements, CardElement } from '@stripe/react-stripe-js';
import { toast } from '@/components/ui/use-toast';
import { format, isValid, parseISO } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/customSupabaseClient';
import { formatCurrency } from '@/api/EcommerceApi';

const addonPrices = {
  insurance: 20,
  drivewayProtection: 15,
};

const equipmentList = [
  { id: 'wheelbarrow', label: 'Wheelbarrow', price: 10 },
  { id: 'handTruck', label: 'Hand Truck', price: 15 },
  { id: 'gloves', label: 'Working Gloves (Pair)', price: 5 }
];

const ConfirmationLine = ({ label, value }) => (
  <div className="flex justify-between items-start py-1.5 border-b border-white/5 last:border-0">
    <p className="font-medium text-blue-200/80 w-1/3 pr-2">{label}:</p>
    <p className="text-right w-2/3 text-white font-medium">{typeof value === 'string' || typeof value === 'number' ? value : 'N/A'}</p>
  </div>
);

const BreakdownLine = ({ label, value }) => {
  const formatMoney = (amount) => formatCurrency(Math.round(amount * 100), { symbol: '$' });
  
  return (
    <div className="flex justify-between items-center py-1">
      <span>{typeof label === 'string' ? label : 'Item'}</span>
      <span>{formatMoney(value || 0)}</span>
    </div>
  );
};

export const PaymentPage = ({
  totalPrice,
  bookingData,
  plan,
  addonsData,
  onBack,
  bookingId,
  deliveryService,
  paymentIntentId
}) => {
  const stripe = useStripe();
  const elements = useElements();

  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [formError, setFormError] = useState(null);
  const [isCardReady, setIsCardReady] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [mileageRate, setMileageRate] = useState(plan?.mileage_rate !== undefined ? plan.mileage_rate : 20);

  useEffect(() => {
    const fetchRate = async () => {
      if (plan?.id) {
        const { data, error } = await supabase.from('services').select('mileage_rate').eq('id', plan.id).single();
        if (!error && data && data.mileage_rate !== null) {
          setMileageRate(Number(data.mileage_rate));
        }
      }
    };
    fetchRate();
  }, [plan?.id]);

  if (!paymentIntentId || typeof paymentIntentId !== 'string') {
    return (
      <div className="container mx-auto py-16 px-4">
        <div className="max-w-2xl mx-auto bg-slate-900/60 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-red-500/30 text-center relative z-10">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Payment Session Error</h2>
          <p className="text-red-200 mb-6">
            We could not initialize your secure payment session correctly. The payment token is missing. Please go back and try again.
          </p>
          <Button onClick={onBack} variant="outline" className="border-red-500 text-red-400 hover:bg-red-500 hover:text-white transition-colors">
            <ArrowLeft className="mr-2 h-4 w-4" /> Return to Previous Step
          </Button>
        </div>
      </div>
    );
  }

  const isDelivery = plan?.id === 2 && deliveryService;
  const currentPlan = isDelivery ? { ...plan, name: "Dump Loader Trailer with Delivery" } : (plan || {});
  const planName = currentPlan.name || 'Selected Service';

  const displayAddress = addonsData?.deliveryAddress?.street ? addonsData.deliveryAddress : bookingData?.contactAddress;
  const addressToUse = displayAddress?.street ? displayAddress : (bookingData?.contactAddress || {});
  
  const hasRequiredFields = !!(addressToUse?.street && addressToUse?.city && addressToUse?.state && addressToUse?.zip);
  const isAddressVerifiedStatus = bookingData?.addressVerified || addressToUse?.isVerified || addonsData?.distanceInfo?.unverifiedAddress;
  const isAddressValid = hasRequiredFields && isAddressVerifiedStatus;

  const firstName = bookingData?.firstName || bookingData?.first_name || '';
  const lastName = bookingData?.lastName || bookingData?.last_name || '';
  const customerFullName = `${firstName} ${lastName}`.trim() || bookingData?.name || 'N/A';
  const customerEmail = bookingData?.email || 'N/A';

  const finalizeBookingProcess = async () => {
    try {
      const { error: finalizeError } = await supabase.functions.invoke('finalize-booking', {
        body: { booking_id: bookingId }
      });
      if (finalizeError) console.error("Booking finalized with warnings:", finalizeError);
    } catch (finalizeErr) {
      console.error("Failed to invoke finalize-booking:", finalizeErr);
    }
  };

  const handlePayment = async (e) => {
    e.preventDefault();
    setFormError(null);
    
    if (!stripe || !elements) {
      setFormError("Stripe is still initializing. Please check your connection and try again.");
      return;
    }

    if (!isConfirmed) {
      toast({ title: "Confirmation Required", description: "Please confirm your details before paying.", variant: "destructive" });
      return;
    }
    
    if (!isCardReady) {
       setFormError("The payment field is not ready. Please refresh the page.");
       return;
    }

    if (!totalPrice || totalPrice <= 0) {
      setFormError("Invalid total order price.");
      return;
    }

    setIsProcessing(true);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Payment form element was not found in the page. Please refresh.");

      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
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
      });

      if (pmError) throw new Error(pmError.message || "Failed to process card details. Please check your card info.");

      const amountInCents = Math.round(totalPrice * 100);

      const { data: confirmData, error: confirmError } = await supabase.functions.invoke('confirm-payment', {
        body: {
          payment_intent_id: paymentIntentId,
          payment_method_id: paymentMethod.id,
          amount: amountInCents,
          currency: 'usd',
          booking_data: bookingData,
          booking_id: bookingId
        }
      });

      if (confirmError) {
          let errMsg = confirmError.message || "Failed to communicate with payment server.";
          if (confirmError.context) {
              try {
                  const errorJson = await confirmError.context.json();
                  if (errorJson?.error) errMsg = errorJson.error;
              } catch (e) {
                 // ignore parsing error
              }
          }
          throw new Error(errMsg);
      }

      if (!confirmData) throw new Error("Received empty response from payment server.");

      if (confirmData.success && confirmData.status === 'succeeded') {
        await finalizeBookingProcess();
        window.location.href = `/confirmation?booking_id=${bookingId}`;
        
      } else if (confirmData.status === 'requires_action') {
        const { error: actionError } = await stripe.handleCardAction(confirmData.client_secret);
        if (actionError) throw new Error(actionError.message || "Authentication failed or was canceled.");

        const { data: verifyData, error: verifyError } = await supabase.functions.invoke('confirm-payment', {
          body: {
            payment_intent_id: paymentIntentId,
            amount: amountInCents,
            currency: 'usd',
            booking_id: bookingId
          }
        });

        if (verifyError) throw new Error("Payment verification failed after authentication.");

        if (verifyData?.success && verifyData?.status === 'succeeded') {
          await finalizeBookingProcess();
          window.location.href = `/confirmation?booking_id=${bookingId}`;
        } else {
          throw new Error(verifyData?.error || "Payment was not authorized successfully.");
        }

      } else {
        throw new Error(confirmData.error || `Payment declined or failed. (Status: ${confirmData.status})`);
      }

    } catch (err) {
      console.error("[PaymentPage] Payment processing exception:", err);
      // Ensure we set a string as form error to prevent React crash
      setFormError(typeof err.message === 'string' ? err.message : "A critical error occurred while processing your payment.");
      setIsProcessing(false);
    }
  };

  const formatTime = (timeString) => {
    if (!timeString) return 'N/A';
    try {
        const [hours, minutes] = timeString.split(':');
        const date = new Date();
        date.setHours(parseInt(hours, 10));
        date.setMinutes(parseInt(minutes || '0', 10));
        return isValid(date) ? format(date, 'h:mm a') : (typeof timeString === 'string' ? timeString : 'N/A');
    } catch (e) {
        return typeof timeString === 'string' ? timeString : 'N/A';
    }
  };

  const formatDate = (date) => {
    if (!date) return 'N/A';
    try {
      const parsedDate = date instanceof Date ? date : parseISO(date.toString());
      if (!isValid(parsedDate)) return "Invalid Date";
      return format(parsedDate, 'PPP');
    } catch (e) {
      return "Invalid Date";
    }
  };
  
  const formatMoney = (amount) => formatCurrency(Math.round((amount || 0) * 100), { symbol: '$' });

  // Standard robust styling for Stripe CardElement
  const cardElementOptions = {
    style: {
      base: {
        color: '#1f2937', // Dark gray for high contrast on white background
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
        fontSmoothing: 'antialiased',
        fontSize: '16px',
        lineHeight: '24px',
        '::placeholder': { color: '#9ca3af' }
      },
      invalid: { color: '#ef4444', iconColor: '#ef4444' },
      complete: { color: '#16a34a', iconColor: '#16a34a' }
    },
    hidePostalCode: true,
  };

  const basePrice = currentPlan?.base_price || currentPlan?.price || 0;
  
  const freeDistance = plan?.id === 1 ? 30 : 0;
  const chargeableDistance = Math.max(0, (addonsData?.deliveryDistance || 0) - freeDistance);
  const mileageCharge = addonsData?.deliveryDistance ? chargeableDistance * mileageRate : (addonsData?.mileageCharge || 0);
  
  const insuranceCharge = addonsData?.insurance === 'accept' ? addonPrices.insurance : 0;
  const drivewayCharge = (plan?.id === 1 || isDelivery) && addonsData?.drivewayProtection === 'accept' ? addonPrices.drivewayProtection : 0;
  
  let equipmentTotal = 0;
  const equipmentItems = [];
  if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
    addonsData.equipment.forEach(item => {
      const details = equipmentList.find(e => e.id === item.id);
      if (details) {
        const itemTotal = details.price * item.quantity;
        equipmentTotal += itemTotal;
        equipmentItems.push({ label: details.label, quantity: item.quantity, price: itemTotal });
      }
    });
  }

  const subtotal = basePrice + mileageCharge + insuranceCharge + drivewayCharge + equipmentTotal;
  const estimatedTax = totalPrice > subtotal + 0.01 ? totalPrice - subtotal : 0;

  // Format string properly to avoid passing objects to JSX
  const formattedAddress = `${addressToUse?.street || ''}, ${addressToUse?.city || ''}, ${addressToUse?.state || ''} ${addressToUse?.zip || ''}`.replace(/^[,\s]+|[,\s]+$/g, '');

  return (
    <motion.div 
      initial={{ opacity: 0, x: 100 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -100 }} 
      transition={{ duration: 0.5 }} 
      className="container mx-auto py-16 px-4"
    >
      <div className="max-w-2xl mx-auto bg-slate-900/60 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 relative z-10">
        <div className="flex items-center mb-8">
          <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20" disabled={isProcessing}>
            <ArrowLeft />
          </Button>
          <h2 className="text-3xl font-bold text-white">Secure Payment</h2>
        </div>

        {!isAddressValid ? (
            <div className="bg-red-900/50 border border-red-500/30 p-6 rounded-xl text-center mb-8">
                <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">Address Information Incomplete</h3>
                <p className="text-red-200 mb-6">Address information is incomplete or unverified. Please go back and verify your address.</p>
                <Button onClick={onBack} variant="outline" className="border-red-500 text-red-400 hover:bg-red-500 hover:text-white transition-colors">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Verify Address
                </Button>
            </div>
        ) : (
            <>
                <div className="bg-white/5 p-6 rounded-lg mb-8 border border-white/10">
                  <h3 className="text-2xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2">Order Summary</h3>
                  <div className="space-y-3 text-white mb-6">
                    <ConfirmationLine label="Service" value={planName} />
                    <ConfirmationLine label="Customer Name" value={customerFullName} />
                    <ConfirmationLine label="Email" value={customerEmail} />
                    <ConfirmationLine label="Address" value={formattedAddress || 'N/A'} />
                    <ConfirmationLine label={plan?.id === 2 ? (isDelivery ? 'Delivery' : 'Pickup') : 'Drop-off'} value={`${formatDate(bookingData?.dropOffDate)} at ${formatTime(bookingData?.dropOffTimeSlot)}`} />
                    <ConfirmationLine label={plan?.id === 2 ? (isDelivery ? 'Pickup' : 'Return') : 'Pickup'} value={`${formatDate(bookingData?.pickupDate)} by ${formatTime(bookingData?.pickupTimeSlot)}`} />
                  </div>

                  <h4 className="text-xl font-bold text-yellow-400 mb-3 border-b border-white/10 pb-2">Charges Breakdown</h4>
                  <div className="space-y-2 text-blue-100 font-mono text-sm">
                    <BreakdownLine label="Base Service Charge" value={basePrice} />
                    
                    {mileageCharge > 0 && <BreakdownLine label={`Mileage Charge (${addonsData?.deliveryDistance?.toFixed(1) || '0.0'} mi total${freeDistance > 0 ? `, ${freeDistance} mi free` : ''} × $${mileageRate})`} value={mileageCharge} />}
                    
                    {equipmentItems.length > 0 && (
                      <div className="pl-4 space-y-1 my-2 border-l-2 border-white/10">
                        <span className="text-white/60 text-xs block mb-1">Equipment:</span>
                        {equipmentItems.map((item, idx) => (
                          <BreakdownLine key={idx} label={`${item.label}${item.quantity > 1 ? ` (x${item.quantity})` : ''}`} value={item.price} />
                        ))}
                      </div>
                    )}

                    {insuranceCharge > 0 && <BreakdownLine label="Rental Insurance" value={insuranceCharge} />}
                    {drivewayCharge > 0 && <BreakdownLine label="Driveway Protection" value={drivewayCharge} />}

                    <div className="border-t border-white/20 my-3 pt-3">
                      <BreakdownLine label="Subtotal" value={subtotal} />
                      <BreakdownLine label="Tax (estimated)" value={estimatedTax} />
                    </div>

                    <div className="border-t border-white/20 pt-4 mt-2">
                      <div className="flex justify-between items-center text-white">
                        <span className="text-lg font-bold">Total Amount:</span>
                        <span className="text-2xl font-bold text-green-400">{formatMoney(totalPrice)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <form onSubmit={handlePayment} className="text-center relative z-20">
                  
                  <div className="mb-6 bg-white/5 p-5 rounded-lg border border-white/10 text-left relative z-30">
                    <Label className="block text-blue-200 mb-3 text-sm font-medium">Credit or Debit Card</Label>
                    <div 
                      className={`p-4 bg-white rounded-md border transition-all duration-200 min-h-[56px] flex flex-col justify-center ${
                        isFocused ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md' : formError ? 'border-red-500 shadow-sm' : 'border-gray-200 shadow-sm'
                      }`}
                    >
                      <div className="w-full relative block z-40" id="card-element-container">
                        <CardElement 
                          id="card-element"
                          options={cardElementOptions} 
                          onReady={() => setIsCardReady(true)}
                          onChange={(e) => setFormError(e.error ? (typeof e.error.message === 'string' ? e.error.message : 'Invalid card details') : null)}
                          onFocus={() => setIsFocused(true)}
                          onBlur={() => setIsFocused(false)}
                        />
                      </div>
                    </div>
                    
                    {formError && (
                      <div className="mt-4 flex items-start text-red-400 text-sm bg-red-950/40 p-3 rounded border border-red-500/30">
                        <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" />
                        <p>{typeof formError === 'string' ? formError : 'Payment error occurred.'}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-3 mb-8 bg-white/5 p-4 rounded-lg justify-center border border-white/10">
                    <Checkbox 
                      id="confirm-details" 
                      checked={isConfirmed} 
                      onCheckedChange={setIsConfirmed} 
                      disabled={isProcessing} 
                      className="border-white/50 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
                    />
                    <Label htmlFor="confirm-details" className="text-sm text-blue-100 leading-snug cursor-pointer select-none">
                      I have thoroughly reviewed all the information above and confirm it is correct.
                    </Label>
                  </div>
                  
                  <Button 
                    type="submit" 
                    disabled={isProcessing || !isConfirmed || !stripe || !elements || !isCardReady} 
                    className={`w-full py-6 text-xl font-bold transition-all duration-300 relative z-30 ${
                        isProcessing || !isConfirmed || !stripe || !isCardReady
                        ? 'bg-white/10 text-white/50 cursor-not-allowed border border-white/10'
                        : 'bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white shadow-xl shadow-green-900/40 border border-green-400/30 transform active:scale-[0.98]'
                    }`}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                        Processing payment...
                      </>
                    ) : (
                      <>
                        <CreditCard className="mr-3 h-6 w-6" />
                        Pay {formatMoney(totalPrice)}
                      </>
                    )}
                  </Button>
                  
                  <div className="mt-6 flex flex-col items-center justify-center space-y-3 relative z-30">
                    <p className="text-xs text-gray-400 flex items-center bg-black/20 px-3 py-1.5 rounded-full">
                      <Lock className="h-3 w-3 mr-1.5 text-blue-400" /> Secure 256-bit SSL Encrypted Payment
                    </p>
                    <div className="text-xs text-blue-200/70 bg-blue-900/30 py-1.5 px-3 rounded-md border border-blue-800/50 flex items-center shadow-inner">
                      Testing? Use card: <span className="font-mono bg-black/40 px-1.5 py-0.5 rounded text-blue-100 tracking-wider ml-1">4242 4242 4242 4242</span>
                    </div>
                  </div>
                </form>
            </>
        )}
      </div>
    </motion.div>
  );
};
