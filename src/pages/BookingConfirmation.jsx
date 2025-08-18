import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, Home, Calendar, Mail, DollarSign, User, Phone, MapPin, Clock, Loader2, AlertTriangle, XCircle, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';

const ConfirmationLine = ({ label, value, icon }) => (
  <div className="flex items-start py-3">
    <div className="text-yellow-400 mr-4 flex-shrink-0">{icon}</div>
    <div>
      <p className="font-semibold text-blue-100">{label}</p>
      <p className="text-white break-words">{value}</p>
    </div>
  </div>
);

function BookingConfirmation() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [booking, setBooking] = useState(null);
  const [status, setStatus] = useState('loading'); // loading, success, error, pending
  const receiptRef = useRef();

  const handlePrint = useReactToPrint({
    content: () => receiptRef.current,
    documentTitle: `U-Fill-Receipt-${booking?.id || 'booking'}`,
  });

  useEffect(() => {
    if (!sessionId) {
      setStatus('error');
      toast({ title: "Missing Payment Session", description: "Cannot find booking confirmation details.", variant: "destructive" });
      return;
    }

    const verifySessionAndFetchBooking = async () => {
      try {
        const { data: sessionStatusData, error: sessionStatusError } = await supabase.functions.invoke('get-session-status', {
          body: { sessionId }
        });

        if (sessionStatusError) throw new Error("Could not verify payment session.");

        if (sessionStatusData.status === 'complete' && sessionStatusData.payment_status === 'paid') {
           const { data: bookingData, error: bookingError } = await supabase.functions.invoke('get-booking-by-session', {
             body: { sessionId }
           });
            if(bookingError || !bookingData.booking) {
                // This can happen if webhook is slightly delayed. We show a pending screen.
                setStatus('pending');
            } else {
                setBooking(bookingData.booking);
                setStatus('success');
            }
        } else {
          throw new Error("Payment was not completed successfully.");
        }
      } catch (err) {
        console.error("Error verifying payment and fetching booking:", err);
        setStatus('error');
        toast({ title: "Payment Verification Failed", description: err.message, variant: "destructive", duration: 10000 });
      }
    };

    verifySessionAndFetchBooking();

  }, [sessionId]);

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)]">
        <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
        <p className="text-white text-2xl mt-4">Verifying your payment...</p>
        <p className="text-blue-200 mt-2">Please wait a moment.</p>
      </div>
    );
  }

  if (status === 'pending') {
     return (
       <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] text-center">
        <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
        <h1 className="text-white text-3xl mt-4 font-bold">Confirmation Processing</h1>
        <p className="text-blue-200 mt-2 max-w-md">Your payment was successful! We are finalizing your booking details. This page will update automatically. If it doesn't, please check your email for a receipt.</p>
      </div>
    );
  }

  if (status === 'error' || !booking) {
    return (
       <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] text-center">
        <XCircle className="h-16 w-16 text-red-500" />
        <h1 className="text-white text-3xl mt-4 font-bold">Payment Issue Encountered</h1>
        <p className="text-blue-200 mt-2 max-w-md">There was an issue verifying your payment. If you believe this is an error, please contact support. Otherwise, you can return to the homepage to try again.</p>
         <Link to="/">
          <Button className="mt-8">
            <Home className="mr-2" /> Back to Homepage
          </Button>
        </Link>
      </div>
    );
  }
  
  const { customers, plan, drop_off_date, pickup_date, total_price, drop_off_time_slot, pickup_time_slot, addons } = booking;
  
  if (!customers) {
     return (
       <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] text-center">
        <AlertTriangle className="h-16 w-16 text-red-500" />
        <h1 className="text-white text-3xl mt-4 font-bold">Error Loading Details</h1>
        <p className="text-blue-200 mt-2 max-w-md">Could not load customer details for this booking. Please refer to your confirmation email.</p>
         <Link to="/">
          <Button className="mt-8">
            <Home className="mr-2" /> Back to Homepage
          </Button>
        </Link>
      </div>
    );
  }
  
  const formatTime = (timeString) => {
      if (!timeString) return 'N/A';
      try {
          const date = new Date(`1970-01-01T${timeString}`);
          return format(date, 'h:mm a');
      } catch (e) {
          return 'N/A';
      }
  };

  const { name, email, phone, street, city, state, zip } = customers;
  const fullAddress = `${street}, ${city}, ${state} ${zip}`;

  return (
    <>
      <div className="hidden">
        <PrintableReceipt ref={receiptRef} booking={booking} />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="container mx-auto py-16 px-4"
      >
        <div className="max-w-3xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 260, damping: 20 }}
          >
            <CheckCircle className="h-24 w-24 text-green-400 mx-auto mb-6" />
          </motion.div>
          <h1 className="text-4xl font-bold text-white mb-4">Booking Confirmed!</h1>
          <p className="text-lg text-blue-200 mb-8">
            Thank you, {name}! Your rental is scheduled. A confirmation email with all details has been sent to {email}.
          </p>

          <div className="bg-white/5 p-6 rounded-lg mb-8 text-left divide-y divide-white/10">
            <ConfirmationLine icon={<User className="h-6 w-6" />} label="Name" value={name} />
             <ConfirmationLine icon={<Mail className="h-6 w-6" />} label="Email" value={email} />
            <ConfirmationLine icon={<Phone className="h-6 w-6" />} label="Phone" value={phone} />
             <ConfirmationLine icon={<MapPin className="h-6 w-6" />} label="Address" value={fullAddress} />
            <ConfirmationLine icon={<Calendar className="h-6 w-6" />} label="Service" value={plan.name} />
            <ConfirmationLine icon={<Clock className="h-6 w-6" />} label={plan.id === 2 ? "Pickup" : "Drop-off"} value={`${format(parseISO(drop_off_date), 'PPP')} at ${formatTime(drop_off_time_slot)}`} />
             <ConfirmationLine icon={<Clock className="h-6 w-6" />} label={plan.id === 2 ? "Return" : "Pickup"} value={`${format(parseISO(pickup_date), 'PPP')} by ${formatTime(pickup_time_slot)}`} />
            <ConfirmationLine icon={<DollarSign className="h-6 w-6" />} label="Total Amount Paid" value={`$${total_price.toFixed(2)}`} />
          </div>

          <p className="text-blue-200 mb-8">
            If you have any questions, please don't hesitate to contact us.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <Button onClick={handlePrint} variant="outline" className="w-full py-3 text-lg font-semibold border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black">
              <Printer className="mr-2" /> Print Receipt
            </Button>
            <Link to="/" className="w-full">
              <Button className="w-full py-3 text-lg font-semibold bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-black">
                <Home className="mr-2" /> Back to Homepage
              </Button>
            </Link>
          </div>
        </div>
      </motion.div>
    </>
  );
}

export default BookingConfirmation;