
import React, { useState, useEffect } from 'react';
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

const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise =
  typeof stripePublishableKey === 'string' && stripePublishableKey.trim()
    ? loadStripe(stripePublishableKey)
    : null;

const addonPrices = {
  insurance: 20,
  drivewayProtection: 15,
};

const equipmentList = [
  { id: 'wheelbarrow', label: 'Wheelbarrow', price: 10 },
  { id: 'handTruck', label: 'Hand Truck', price: 15 },
  { id: 'gloves', label: 'Working Gloves (Pair)', price: 5 }
];

const formatMoney = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount ?? 0);

const ConfirmationLine = ({ label, value }) => (
  <div className="flex justify-between items-start py-1.5 border-b border-white/5 last:border-0">
    <p className="font-medium text-blue-200/80 w-1/3 pr-2">{label}:</p>
    <p className="text-right w-2/3 text-white font-medium">{value ?? 'N/A'}</p>
  </div>
);

const BreakdownLine = ({ label, value }) => (
  <div className="flex justify-between items-center py-1">
    <span>{label}</span>
    <span>{formatMoney(value)}</span>
  </div>
);

const CheckoutForm = ({
  totalPrice,
  bookingData,
  plan,
  addonsData,
  onBack,
  bookingId,
  deliveryService,
  clientSecret
}) => {
  const stripe = useStripe();
  const elements = useElements();

  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [formError, setFormError] = useState(null);
  const [isPaymentElementReady, setIsPaymentElementReady] = useState(false);

  const isDelivery = plan?.id === 2 && deliveryService;
  const currentPlan = isDelivery ? { ...plan, name: "Dump Loader Trailer with Delivery" } : plan;

  const firstName = bookingData?.firstName || bookingData?.first_name || '';
  const lastName = bookingData?.lastName || bookingData?.last_name || '';
  const customerFullName = `${firstName} ${lastName}`.trim() || bookingData?.name || 'N/A';

  const contactAddress = bookingData?.contactAddress;
  const deliveryAddress = addonsData?.deliveryAddress;
  const addressToUse = (deliveryAddress?.street ? deliveryAddress : null) || contactAddress || {};

  const basePriceAmount = currentPlan?.base_price || currentPlan?.price || 0;
  const deliveryFee = addonsData?.deliveryFee || 0;
  const insuranceCharge = addonsData?.insurance === 'accept' ? addonPrices.insurance : 0;
  const drivewayCharge =
    (plan?.id === 1 || isDelivery) && addonsData?.drivewayProtection === 'accept'
      ? addonPrices.drivewayProtection : 0;
  
  const mattressCharge = (addonsData?.mattressDisposal || 0) * 25;
  const tvCharge = (addonsData?.tvDisposal || 0) * 15;

  const equipmentItems = [];
  let equipmentTotal = 0;
  if (addonsData?.equipment?.length > 0) {
    addonsData.equipment.forEach(item => {
      const details = equipmentList.find(e => e.id === item.id);
      if (details) {
        const itemTotal = details.price * item.quantity;
        equipmentTotal += itemTotal;
        equipmentItems.push({ label: details.label, quantity: item.quantity, price: itemTotal });
      }
    });
  }

  const subtotal = basePriceAmount + deliveryFee + insuranceCharge + drivewayCharge + equipmentTotal + mattressCharge + tvCharge;
  const estimatedTax = totalPrice > subtotal + 0.01 ? totalPrice - subtotal : 0;

  const formatTime = (timeString) => {
    if (!timeString) return 'N/A';
    try {
      const [hours, minutes] = timeString.split(':');
      const date = new Date();
      date.setHours(parseInt(hours, 10));
      date.setMinutes(parseInt(minutes || '0', 10));
      return isValid(date) ? format(date, 'h:mm a') : timeString;
    } catch (e) { return timeString; }
  };

  const formatDate = (date) => {
    if (!date) return 'N/A';
    try {
      const parsedDate = date instanceof Date ? date : parseISO(date.toString());
      if (!isValid(parsedDate)) return "Invalid Date";
      return format(parsedDate, 'PPP');
    } catch (e) { return "Invalid Date"; }
  };

  const handlePayment = async (e) => {
    e.preventDefault();
    setFormError(null);

    const timestamp = new Date().toISOString();

    if (!stripe || !elements) {
      setFormError("Stripe is still initializing. Please wait a moment and try again.");
      return;
    }
    if (!isConfirmed) {
      toast({
        title: "Confirmation Required",
        description: "Please confirm your details are correct before paying.",
        variant: "destructive"
      });
      return;
    }
    if (!isPaymentElementReady) {
      setFormError("Payment form is not ready yet. Please wait.");
      return;
    }

    setIsProcessing(true);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/confirmation?booking_id=${bookingId}`,
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
    });

    if (error) {
      console.error(`[${new Date().toISOString()}] confirmPayment error:`, error);
      if (error.type === 'card_error' || error.type === 'validation_error') {
        setFormError(error.message);
      } else {
        setFormError("An unexpected error occurred processing your payment. Please try again.");
      }
      toast({
        title: "Payment Failed",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive"
      });
      setIsProcessing(false);
    }
    // If successful, Stripe automatically handles the redirect to return_url immediately
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.5 }}
      className="container mx-auto py-16 px-4"
    >
      <div className="max-w-2xl mx-auto bg-slate-900/60 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
        <div className="flex items-center mb-8">
          <Button
            onClick={onBack}
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
          <h3 className="text-2xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2">
            Order Summary
          </h3>
          <div className="space-y-1 text-white mb-6">
            <ConfirmationLine label="Service" value={currentPlan?.name} />
            <ConfirmationLine label="Customer" value={customerFullName} />
            <ConfirmationLine label="Email" value={bookingData?.email} />
            <ConfirmationLine
              label="Address"
              value={addressToUse?.street
                ? `${addressToUse.street}, ${addressToUse.city}, ${addressToUse.state} ${addressToUse.zip}`
                : 'N/A'}
            />
            <ConfirmationLine
              label={plan?.id === 2 ? (isDelivery ? 'Delivery' : 'Pickup') : 'Drop-off'}
              value={`${formatDate(bookingData?.dropOffDate)} at ${formatTime(bookingData?.dropOffTimeSlot)}`}
            />
            <ConfirmationLine
              label={plan?.id === 2 ? (isDelivery ? 'Pickup' : 'Return') : 'Pickup'}
              value={`${formatDate(bookingData?.pickupDate)} by ${formatTime(bookingData?.pickupTimeSlot)}`}
            />
          </div>

          <h4 className="text-lg font-bold text-yellow-400 mb-3 border-b border-white/10 pb-2">
            Charges Breakdown
          </h4>
          <div className="space-y-1 text-blue-100 font-mono text-sm">
            <BreakdownLine label="Base Service Charge" value={basePriceAmount} />
            {deliveryFee > 0 && <BreakdownLine label="Delivery Fee" value={deliveryFee} />}
            {equipmentItems.map((item, idx) => (
              <BreakdownLine
                key={idx}
                label={`${item.label}${item.quantity > 1 ? ` (x${item.quantity})` : ''}`}
                value={item.price}
              />
            ))}
            {mattressCharge > 0 && <BreakdownLine label={`Mattress Disposal (x${addonsData?.mattressDisposal || 0})`} value={mattressCharge} />}
            {tvCharge > 0 && <BreakdownLine label={`TV Disposal (x${addonsData?.tvDisposal || 0})`} value={tvCharge} />}
            {insuranceCharge > 0 && <BreakdownLine label="Rental Insurance" value={insuranceCharge} />}
            {drivewayCharge > 0 && <BreakdownLine label="Driveway Protection" value={drivewayCharge} />}
            <div className="border-t border-white/20 my-2 pt-2">
              <BreakdownLine label="Subtotal" value={subtotal} />
              {estimatedTax > 0 && <BreakdownLine label="Tax (estimated)" value={estimatedTax} />}
            </div>
            <div className="border-t border-white/20 pt-3 mt-1">
              <div className="flex justify-between items-center text-white">
                <span className="text-lg font-bold">Total Amount:</span>
                <span className="text-2xl font-bold text-green-400">{formatMoney(totalPrice)}</span>
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handlePayment}>
          <div className="mb-6">
            <PaymentElement
              onReady={() => {
                setIsPaymentElementReady(true);
              }}
              options={{
                layout: 'tabs',
                fields: {
                  billingDetails: {
                    name: 'never',
                    email: 'never',
                    phone: 'never',
                    address: 'never',
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

          <Button
            type="submit"
            disabled={isProcessing || !isConfirmed || !stripe || !elements || !isPaymentElementReady}
            className={`w-full py-6 text-xl font-bold transition-all duration-300 ${
              isProcessing || !isConfirmed || !stripe || !isPaymentElementReady
                ? 'bg-white/10 text-white/50 cursor-not-allowed border border-white/10'
                : 'bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white shadow-xl shadow-green-900/40 border border-green-400/30 active:scale-[0.98]'
            }`}
          >
            {isProcessing ? (
              <><Loader2 className="mr-3 h-6 w-6 animate-spin" />Processing...</>
            ) : (
              <><CreditCard className="mr-3 h-6 w-6" />Pay {formatMoney(totalPrice)}</>
            )}
          </Button>

          <p className="text-xs text-gray-400 mt-4 flex items-center justify-center">
            <Lock className="h-3 w-3 mr-1.5 text-blue-400" /> Secure 256-bit SSL Encrypted Payment
          </p>
        </form>
      </div>
    </motion.div>
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
}) => {
  const [clientSecret, setClientSecret] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!bookingId) {
      setError("Booking ID is missing. Cannot proceed with payment.");
      return;
    }

    const initPaymentIntent = async () => {
      try {
        const payload = { booking_id: bookingId };
        
        const { data, error: invokeError } = await supabase.functions.invoke('create-payment-intent', {
          body: payload
        });

        if (invokeError) {
          throw invokeError;
        }

        if (data?.error) {
          throw new Error(data.error);
        }

        const secret = data?.clientSecret || data?.client_secret;
        if (!secret) {
          throw new Error("Invalid response from server: missing payment parameters.");
        }

        setClientSecret(secret);
      } catch (err) {
        console.error("Failed to initialize payment intent:", err);
        
        let errorMessage = "Failed to initialize payment gateway. Please try again later.";
        if (err.message && !err.message.includes("Failed to fetch")) {
          errorMessage = `Payment Setup Error: ${err.message}`;
        }
        
        setError(errorMessage);
        toast({
          title: "Payment Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    };

    initPaymentIntent();
  }, [bookingId]);

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

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto bg-red-900/40 border border-red-500/50 p-6 rounded-lg shadow-lg">
          <div className="flex items-center text-red-200 font-bold text-xl mb-4">
            <AlertTriangle className="h-8 w-8 mr-3 text-red-400" />
            Payment Initialization Failed
          </div>
          <p className="text-red-100 mb-6 bg-black/20 p-4 rounded font-mono text-sm border border-red-500/20 break-words">
            {error}
          </p>
          <div className="flex justify-center">
            <Button onClick={onBack} variant="outline" className="text-white hover:bg-white/10 w-full sm:w-auto">
              <ArrowLeft className="mr-2 h-4 w-4" /> Go Back to Review
            </Button>
          </div>
        </div>
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
        borderRadius: '8px',
      },
      rules: {
        '.Input': {
          backgroundColor: '#0f172a',
          border: '1px solid rgba(255,255,255,0.15)',
        },
        '.Input:focus': {
          border: '1px solid #facc15',
          boxShadow: '0 0 0 2px rgba(250,204,21,0.2)',
        },
        '.Label': { color: '#94a3b8' }
      }
    }
  };

  return (
    <Elements stripe={stripePromise} options={elementsOptions}>
      <CheckoutForm
        totalPrice={totalPrice}
        bookingData={bookingData}
        plan={plan}
        addonsData={addonsData}
        onBack={onBack}
        bookingId={bookingId}
        deliveryService={deliveryService}
        clientSecret={clientSecret}
      />
    </Elements>
  );
};
