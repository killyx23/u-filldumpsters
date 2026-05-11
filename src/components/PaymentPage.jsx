
import React, { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, CreditCard, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const CheckoutForm = ({ bookingId, onBack, totalPrice, bookingData }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!stripe || !elements) {
      console.warn('[PaymentPage] Stripe.js has not loaded yet');
      return;
    }

    setIsProcessing(true);
    setErrorMessage('');

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [PaymentPage] TASK 2: Starting payment submission`, {
      bookingId,
      totalPrice,
      email: bookingData?.email
    });

    try {
      // TASK 2 FIX: Construct return URL with booking_id parameter
      const returnUrl = `${window.location.origin}/booking-confirmation?booking_id=${bookingId}`;
      
      console.log(`[${timestamp}] [PaymentPage] TASK 2: Constructed return URL:`, returnUrl);
      console.log(`[${timestamp}] [PaymentPage] TASK 2: Booking ID being preserved:`, bookingId);

      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: returnUrl,
          receipt_email: bookingData?.email,
        },
      });

      if (error) {
        console.error(`[${new Date().toISOString()}] [PaymentPage] Payment confirmation error:`, error);
        setErrorMessage(error.message);
        toast({
          title: 'Payment Error',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        console.log(`[${new Date().toISOString()}] [PaymentPage] TASK 2: ✓ Payment confirmed, redirecting to:`, returnUrl);
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [PaymentPage] Unexpected payment error:`, err);
      setErrorMessage('An unexpected error occurred. Please try again.');
      toast({
        title: 'Payment Error',
        description: 'An unexpected error occurred during payment processing.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white/5 p-6 rounded-xl border border-white/10">
        <div className="flex items-center mb-4 pb-3 border-b border-white/10">
          <CreditCard className="h-6 w-6 text-blue-400 mr-3" />
          <h3 className="text-xl font-bold text-white">Payment Information</h3>
        </div>
        
        <PaymentElement />
        
        {errorMessage && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-500/30 rounded text-red-200 text-sm">
            {errorMessage}
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <Button
          type="button"
          onClick={onBack}
          variant="outline"
          className="flex-1 bg-white/5 border-white/20 text-white hover:bg-white/10"
          disabled={isProcessing}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        
        <Button
          type="submit"
          disabled={!stripe || isProcessing}
          className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-semibold"
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing Payment...
            </>
          ) : (
            <>
              <ShieldCheck className="mr-2 h-5 w-5" />
              Complete Booking (${totalPrice.toFixed(2)})
            </>
          )}
        </Button>
      </div>
    </form>
  );
};

export const PaymentPage = ({ totalPrice, bookingData, plan, addonsData, onBack, bookingId, deliveryService }) => {
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const createPaymentIntent = async () => {
      const timestamp = new Date().toISOString();
      
      console.log(`[${timestamp}] [PaymentPage] TASK 2: Creating payment intent for booking:`, bookingId);

      if (!bookingId) {
        console.error(`[${timestamp}] [PaymentPage] TASK 2: ❌ Missing booking ID - cannot create payment intent`);
        setError('Booking ID is missing. Please go back and try again.');
        setLoading(false);
        return;
      }

      try {
        const payload = {
          bookingId,
          amount: Math.round(totalPrice * 100),
          currency: 'usd',
          customerEmail: bookingData.email,
          metadata: {
            booking_id: bookingId,
            customer_name: `${bookingData.firstName} ${bookingData.lastName}`.trim(),
            service_name: plan?.name || 'Unknown Service',
          }
        };

        console.log(`[${timestamp}] [PaymentPage] Calling create-payment-intent with payload:`, payload);

        const { data, error: invokeError } = await supabase.functions.invoke('create-payment-intent', {
          body: payload
        });

        const responseTs = new Date().toISOString();
        
        if (invokeError) {
          console.error(`[${responseTs}] [PaymentPage] Payment intent creation error:`, invokeError);
          throw invokeError;
        }

        if (!data?.clientSecret) {
          console.error(`[${responseTs}] [PaymentPage] No client secret in response:`, data);
          throw new Error('Failed to create payment intent: No client secret returned');
        }

        console.log(`[${responseTs}] [PaymentPage] TASK 2: ✓ Payment intent created successfully`, {
          hasClientSecret: true,
          bookingId: bookingId
        });

        setClientSecret(data.clientSecret);
        setLoading(false);

      } catch (err) {
        console.error(`[${new Date().toISOString()}] [PaymentPage] Failed to create payment intent:`, err);
        setError(err.message || 'Failed to initialize payment. Please try again.');
        setLoading(false);
        
        toast({
          title: 'Payment Setup Error',
          description: err.message || 'Failed to initialize payment',
          variant: 'destructive',
        });
      }
    };

    createPaymentIntent();
  }, [bookingId, totalPrice, bookingData, plan]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-2xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-blue-400 mb-4" />
            <p className="text-white text-lg">Initializing secure payment...</p>
            <p className="text-gray-400 text-sm mt-2">Please wait while we set up your payment</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-2xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
          <div className="text-center py-8">
            <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-6 mb-6">
              <p className="text-red-200 font-semibold mb-2">Payment Setup Failed</p>
              <p className="text-red-100 text-sm">{error}</p>
            </div>
            <Button onClick={onBack} variant="outline" className="bg-white/5 border-white/20 text-white hover:bg-white/10">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const options = {
    clientSecret,
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#3b82f6',
        colorBackground: '#1e293b',
        colorText: '#ffffff',
        colorDanger: '#ef4444',
        fontFamily: 'system-ui, sans-serif',
        borderRadius: '8px',
      },
    },
  };

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-2xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white mb-2">Secure Payment</h2>
          <p className="text-gray-300">Complete your booking with a secure payment</p>
        </div>

        <div className="bg-gradient-to-br from-blue-900/40 to-indigo-800/20 p-6 rounded-xl mb-8 border border-blue-500/30">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-blue-200 text-sm mb-1">Total Amount Due</p>
              <p className="text-3xl font-bold text-white">${totalPrice.toFixed(2)}</p>
            </div>
            <ShieldCheck className="h-12 w-12 text-green-400" />
          </div>
          <p className="text-blue-100 text-xs mt-3">
            🔒 Your payment is secured by Stripe. We never store your card details.
          </p>
        </div>

        <Elements stripe={stripePromise} options={options}>
          <CheckoutForm 
            bookingId={bookingId} 
            onBack={onBack} 
            totalPrice={totalPrice}
            bookingData={bookingData}
          />
        </Elements>
      </div>
    </div>
  );
};
