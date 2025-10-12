import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CreditCard, Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStripe } from '@stripe/react-stripe-js';
import { toast } from '@/components/ui/use-toast';
import { format, isValid, parseISO } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const addonPrices = {
  insurance: 20,
  drivewayProtection: 15,
};
const equipmentList = [
  { id: 'wheelbarrow', label: 'Wheelbarrow', price: 10 },
  { id: 'handTruck', label: 'Hand Truck', price: 15 },
  { id: 'gloves', label: 'Working Gloves (Pair)', price: 5 }
];

export const PaymentPage = ({
  totalPrice,
  bookingData,
  plan,
  addonsData,
  onBack,
  bookingId,
  deliveryService
}) => {
  const stripe = useStripe();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const isDelivery = plan.id === 2 && deliveryService;
  const currentPlan = isDelivery ? { ...plan, name: "Dump Loader Trailer with Delivery" } : plan;

  const handlePayment = async () => {
    if (!stripe || isProcessing || !isConfirmed) {
      return;
    }
    if (!bookingId) {
      toast({
        title: "Error",
        description: "Booking ID is missing. Cannot proceed with payment.",
        variant: "destructive",
        duration: 15000
      });
      return;
    }
    setIsProcessing(true);
    try {
      const success_url = `${window.location.origin}/confirmation?session_id={CHECKOUT_SESSION_ID}`;
      const cancel_url = `${window.location.origin}/`;
      const {
        data,
        error: functionError
      } = await supabase.functions.invoke('create-stripe-checkout-session', {
        body: {
          totalPrice: totalPrice,
          planName: currentPlan.name,
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
        } catch (e) {
          // Ignore
        }
        throw new Error(errorMsg);
      }
      if (!data || !data.sessionId) {
        throw new Error("Could not create Stripe session.");
      }
      const {
        error: stripeError
      } = await stripe.redirectToCheckout({
        sessionId: data.sessionId
      });
      if (stripeError) {
        throw new Error(stripeError.message);
      }
    } catch (error) {
      console.error("Payment Error:", error);
      toast({
        title: "Payment Initialization Failed",
        description: error.message || "There was an issue redirecting to payment.",
        variant: "destructive",
        duration: 15000
      });
      setIsProcessing(false);
    }
  };

  const formatTime = timeString => {
    if (!timeString) return 'N/A';
    const [hours, minutes] = timeString.split(':');
    const date = new Date();
    date.setHours(parseInt(hours, 10));
    date.setMinutes(parseInt(minutes, 10));
    return isValid(date) ? format(date, 'h:mm a') : 'N/A';
  };

  const formatDate = date => {
    if (!date) return 'N/A';
    try {
      const parsedDate = date instanceof Date ? date : parseISO(date.toString());
      if (!isValid(parsedDate)) return "Invalid Date";
      return format(parsedDate, 'PPP');
    } catch (e) {
      return "Invalid Date";
    }
  };

  return <motion.div initial={{
    opacity: 0,
    x: 100
  }} animate={{
    opacity: 1,
    x: 0
  }} exit={{
    opacity: 0,
    x: -100
  }} transition={{
    duration: 0.5
  }} className="container mx-auto py-16 px-4">
      <div className="max-w-2xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
        <div className="flex items-center mb-8">
          <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
            <ArrowLeft />
          </Button>
          <h2 className="text-3xl font-bold text-white">Step 5: Secure Payment</h2>
        </div>

        <div className="bg-white/5 p-6 rounded-lg mb-8">
          <h3 className="text-2xl font-bold text-yellow-400 mb-4">Final Confirmation</h3>
          <div className="space-y-3 text-white">
            <ConfirmationLine label="Service" value={currentPlan.name} />
            <ConfirmationLine label="Name" value={bookingData.name} />
            <ConfirmationLine label="Email" value={bookingData.email} />
            <ConfirmationLine label="Address" value={`${bookingData.street}, ${bookingData.city}, ${bookingData.state} ${bookingData.zip}`} />
            <ConfirmationLine label={plan.id === 2 ? (isDelivery ? 'Delivery' : 'Pickup') : 'Drop-off'} value={`${formatDate(bookingData.dropOffDate)} at ${formatTime(bookingData.dropOffTimeSlot)}`} />
            <ConfirmationLine label={plan.id === 2 ? (isDelivery ? 'Pickup' : 'Return') : 'Pickup'} value={`${formatDate(bookingData.pickupDate)} by ${formatTime(bookingData.pickupTimeSlot)}`} />

            {addonsData.insurance === 'accept' && <ConfirmationLine label="Rental Insurance" value={`$${addonPrices.insurance.toFixed(2)}`} />}
            {(plan.id === 1 || isDelivery) && addonsData.drivewayProtection === 'accept' && <ConfirmationLine label="Driveway Protection" value={`$${addonPrices.drivewayProtection.toFixed(2)}`} />}
            {addonsData.equipment.length > 0 && <div>
                <p className="font-semibold">Equipment:</p>
                <ul className="list-disc list-inside pl-4 text-blue-200">
                  {addonsData.equipment.map(item => {
                const equipmentDetails = equipmentList.find(e => e.id === item.id);
                const equipmentPrice = equipmentDetails?.price;
                const quantityText = item.quantity > 1 ? ` x ${item.quantity}` : '';
                return <li key={item.id}>
                        {equipmentDetails?.label}{quantityText} - ${equipmentPrice ? (equipmentPrice * item.quantity).toFixed(2) : '0.00'}
                      </li>;
              })}
                </ul>
              </div>}

            <div className="border-t border-white/20 pt-4 mt-4">
              <div className="text-white text-2xl font-semibold flex justify-between">
                <span>Total Amount:</span>
                <div className='flex items-baseline'>
                  <span className="text-green-400">${totalPrice.toFixed(2)}</span>
                  <span className="text-sm text-blue-200 ml-2">(plus tax)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center">
          <div className="flex items-center space-x-2 mb-6 bg-white/5 p-4 rounded-lg justify-center">
            <Checkbox id="confirm-details" checked={isConfirmed} onCheckedChange={setIsConfirmed} />
            <Label htmlFor="confirm-details" className="text-sm text-blue-200 leading-snug cursor-pointer">
              I have thoroughly reviewed all the information above and confirm it is correct.
            </Label>
          </div>

          <p className="text-blue-200 mb-4">You will be redirected to Stripe for secure payment processing.</p>
          <Button onClick={handlePayment} disabled={isProcessing || !stripe || !isConfirmed} className="w-full py-4 text-xl font-semibold bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white disabled:opacity-50 disabled:cursor-not-allowed">
            {isProcessing ? <Loader2 className="mr-3 h-6 w-6 animate-spin" /> : <CreditCard className="mr-3" />}
            {isProcessing ? `Processing...` : `Pay $${totalPrice.toFixed(2)} with Card (plus tax)`}
          </Button>
          <p className="text-xs text-gray-400 mt-4 flex items-center justify-center">
            <Lock className="h-3 w-3 mr-1.5" /> Secure SSL Encrypted Payment
          </p>
        </div>
      </div>
    </motion.div>;
};
const ConfirmationLine = ({
  label,
  value
}) => <div className="flex justify-between items-start">
    <p className="font-semibold text-blue-100 w-1/3">{label}:</p>
    <p className="text-right w-2/3">{value}</p>
  </div>;