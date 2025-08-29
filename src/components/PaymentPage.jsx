import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CreditCard, Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStripe } from '@stripe/react-stripe-js';
import { toast } from '@/components/ui/use-toast';
import { format, isValid, parseISO } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';

const addonPrices = {
  insurance: 15,
  drivewayProtection: 10,
  equipment: {
    wheelbarrow: 20,
    handTruck: 15,
    gloves: 5,
  },
};

const equipmentList = [
  { id: 'wheelbarrow', label: 'Wheelbarrow' },
  { id: 'handTruck', label: 'Hand Truck' },
  { id: 'gloves', label: 'Working Gloves (Pair)' },
];

export const PaymentPage = ({ totalPrice, bookingData, plan, addonsData, onBack, bookingId }) => {
  const stripe = useStripe();
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePayment = async () => {
    if (!stripe || isProcessing) {
        return;
    }
    if (!bookingId) {
      toast({
        title: "Error",
        description: "Booking ID is missing. Cannot proceed with payment.",
        variant: "destructive",
        duration: 15000,
      });
      return;
    }
    setIsProcessing(true);

    try {
      const success_url = `${window.location.origin}/confirmation?session_id={CHECKOUT_SESSION_ID}`;
      const cancel_url = `${window.location.origin}/`;

      const { data, error: functionError } = await supabase.functions.invoke('create-stripe-checkout-session', {
        body: {
          totalPrice: totalPrice,
          planName: plan.name,
          customerEmail: bookingData.email,
          customerName: bookingData.name,
          success_url: success_url,
          cancel_url: cancel_url,
          bookingId: bookingId
        }
      });

      if (functionError) {
          let errorMsg = `Stripe session creation failed: ${functionError.message}`;
          try {
              const contextError = await functionError.context.json();
              if (contextError.error) {
                  errorMsg = contextError.error;
              }
          } catch(e) {
            // Ignore
          }
          throw new Error(errorMsg);
      }
      
      if (!data || !data.sessionId) {
        throw new Error("Could not create Stripe session.");
      }
      
      const { error: stripeError } = await stripe.redirectToCheckout({ sessionId: data.sessionId });

      if (stripeError) {
        throw new Error(stripeError.message);
      }
    } catch (error) {
      console.error("Payment Error:", error);
      toast({
        title: "Payment Initialization Failed",
        description: error.message || "There was an issue redirecting to payment.",
        variant: "destructive",
        duration: 15000,
      });
      setIsProcessing(false);
    }
  };

  const formatTime = (timeString) => {
    if (!timeString) return '';
    try {
        const date = new Date(`1970-01-01T${timeString}`);
        if (!isValid(date)) return "Invalid Time";
        return format(date, 'h:mm a');
    } catch (e) {
        return "Invalid Time";
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

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.5 }}
      className="container mx-auto py-16 px-4"
    >
      <div className="max-w-2xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
        <div className="flex items-center mb-8">
          <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
            <ArrowLeft />
          </Button>
          <h2 className="text-3xl font-bold text-white">Step 3: Secure Payment</h2>
        </div>

        <div className="bg-white/5 p-6 rounded-lg mb-8">
          <h3 className="text-2xl font-bold text-yellow-400 mb-4">Final Confirmation</h3>
          <div className="space-y-3 text-white">
            <ConfirmationLine label="Service" value={plan.name} />
            <ConfirmationLine label="Name" value={bookingData.name} />
            <ConfirmationLine label="Email" value={bookingData.email} />
            <ConfirmationLine label="Address" value={`${bookingData.street}, ${bookingData.city}, ${bookingData.state} ${bookingData.zip}`} />
            <ConfirmationLine label={plan.id === 2 ? 'Pickup' : 'Drop-off'} value={`${formatDate(bookingData.dropOffDate)} at ${formatTime(bookingData.dropOffTimeSlot)}`} />
            <ConfirmationLine label={plan.id === 2 ? 'Return' : 'Pickup'} value={`${formatDate(bookingData.pickupDate)} by ${formatTime(bookingData.pickupTimeSlot)}`} />

            {addonsData.insurance === 'accept' && <ConfirmationLine label="Rental Insurance" value={`$${addonPrices.insurance.toFixed(2)}`} />}
            {plan.id !== 2 && addonsData.drivewayProtection === 'accept' && <ConfirmationLine label="Driveway Protection" value={`$${addonPrices.drivewayProtection.toFixed(2)}`} />}
            {addonsData.equipment.length > 0 && (
              <div>
                <p className="font-semibold">Equipment:</p>
                <ul className="list-disc list-inside pl-4 text-blue-200">
                  {addonsData.equipment.map(item => {
                    const equipmentDetails = equipmentList.find(e => e.id === item.id);
                    const equipmentPrice = addonPrices.equipment[item.id];
                    const quantityText = item.quantity > 1 ? ` x ${item.quantity}` : '';
                    return (
                      <li key={item.id}>
                        {equipmentDetails?.label}{quantityText} - ${equipmentPrice ? (equipmentPrice * item.quantity).toFixed(2) : '0.00'}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="border-t border-white/20 pt-4 mt-4">
              <div className="text-white text-2xl font-semibold flex justify-between">
                <span>Total Amount:</span>
                <div className='flex items-baseline'>
                  <span className="text-green-400">${totalPrice.toFixed(2)}</span>
                  <span className="text-sm text-blue-200 ml-2">(plus taxes)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center">
          <p className="text-blue-200 mb-4">You will be redirected to Stripe for secure payment processing.</p>
          <Button onClick={handlePayment} disabled={isProcessing || !stripe} className="w-full py-4 text-xl font-semibold bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white disabled:opacity-50">
            {isProcessing ? <Loader2 className="mr-3 h-6 w-6 animate-spin" /> : <CreditCard className="mr-3" />}
            {isProcessing ? `Processing...` : `Pay $${totalPrice.toFixed(2)} with Card (plus taxes)`}
          </Button>
          <p className="text-xs text-gray-400 mt-4 flex items-center justify-center">
            <Lock className="h-3 w-3 mr-1.5" /> Secure SSL Encrypted Payment
          </p>
        </div>
      </div>
    </motion.div>
  );
};

const ConfirmationLine = ({ label, value }) => (
  <div className="flex justify-between items-start">
    <p className="font-semibold text-blue-100 w-1/3">{label}:</p>
    <p className="text-right w-2/3">{value}</p>
  </div>
);