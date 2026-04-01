import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { CheckCircle, Home, AlertTriangle, Calendar, MapPin, Mail, Loader2, RefreshCw, Key, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';

export default function BookingConfirmation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookingId = searchParams.get('booking_id');
  
  const [loading, setLoading] = useState(true);
  const [bookingDetails, setBookingDetails] = useState(null);
  const [serviceDetails, setServiceDetails] = useState(null);
  
  // Email state: 'pending', 'sent', 'failed'
  const [emailStatus, setEmailStatus] = useState('pending');
  const [resendingEmail, setResendingEmail] = useState(false);
  const [emailErrorMsg, setEmailErrorMsg] = useState('');
  
  const [errorMsg, setErrorMsg] = useState(null);

  const receiptRef = useRef();
  
  const handlePrint = useReactToPrint({
    content: () => receiptRef.current,
    documentTitle: `Receipt-Booking-${bookingId}`,
    removeAfterPrint: true,
  });

  useEffect(() => {
    let isMounted = true;
    
    if (!bookingId) {
      setErrorMsg("Booking ID is missing from the URL. Cannot retrieve details.");
      setLoading(false);
      return;
    }

    // Timeout protection for fetching booking data (10s)
    const timeoutId = setTimeout(() => {
      if (loading && isMounted) {
        setErrorMsg("Loading timed out. Please check your internet connection or refresh the page.");
        setLoading(false);
      }
    }, 10000);

    const fetchBookingData = async () => {
      try {
        const { data: booking, error: fetchError } = await supabase
          .from('bookings')
          .select('*, customers(*)')
          .eq('id', bookingId)
          .single();

        if (fetchError || !booking) {
          throw new Error(fetchError?.message || "Could not find the requested booking in our records.");
        }

        if (isMounted) {
          setBookingDetails(booking);
          
          let resolvedServiceId = booking.plan?.service_id || booking.plan?.id;
          if (booking.addons?.deliveryService && resolvedServiceId === 2) {
            resolvedServiceId = 4;
          }

          if (resolvedServiceId) {
            const { data: service } = await supabase
              .from('services')
              .select('*')
              .eq('id', resolvedServiceId)
              .single();

            if (service && isMounted) {
              setServiceDetails(service);
            }
          }

          // Stop main loading UI *immediately* after data fetch completes
          setLoading(false);
          clearTimeout(timeoutId);

          // Trigger email asynchronously in the background
          triggerBackgroundEmail(booking);
        }
      } catch (error) {
        console.error("Error fetching booking details:", error);
        if (isMounted) {
          setErrorMsg(error.message);
          setLoading(false);
        }
      }
    };

    fetchBookingData();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [bookingId]);

  const triggerBackgroundEmail = async (booking) => {
    setEmailStatus('pending');
    setEmailErrorMsg('');

    // Implement a 30s timeout on the client side for the email status UI
    let hasResponded = false;
    const clientTimeout = setTimeout(() => {
      if (!hasResponded) {
        console.warn("Client-side timeout reached waiting for email confirmation.");
        setEmailStatus('failed');
        setEmailErrorMsg('The email server is taking too long to respond. You can try resending.');
      }
    }, 30000);

    try {
      // Call the edge function asynchronously without awaiting it in the main UI thread
      supabase.functions.invoke('send-booking-confirmation', {
        body: { bookingId: booking.id }  
      }).then(({ data, error }) => {
        hasResponded = true;
        clearTimeout(clientTimeout);

        if (error) {
          console.error("Background email invocation error:", error);
          setEmailStatus('failed');
          setEmailErrorMsg(error.message || 'Failed to connect to email service.');
        } else if (data && data.success === false) {
          console.warn("Background email sending failed:", data.error);
          setEmailStatus('failed');
          setEmailErrorMsg(data.error || 'The email provider rejected the request.');
        } else {
          console.log("Background email sent successfully.");
          setEmailStatus('sent');
        }
      }).catch(err => {
        hasResponded = true;
        clearTimeout(clientTimeout);
        console.error("Exception during background email dispatch:", err);
        setEmailStatus('failed');
        setEmailErrorMsg(err.message || 'An unexpected error occurred while sending the email.');
      });

      // Ensure the status is marked as confirmed if not already
      if (booking.status === 'pending_payment') {
        supabase.from('bookings').update({ status: 'confirmed' }).eq('id', booking.id).then();
      }

    } catch (e) {
      hasResponded = true;
      clearTimeout(clientTimeout);
      console.error("Failed to initiate background email:", e);
      setEmailStatus('failed');
      setEmailErrorMsg('Failed to initiate email delivery.');
    }
  };

  const handleResendEmail = async () => {
    if (!bookingDetails) return;
    
    setResendingEmail(true);
    setEmailErrorMsg('');
    setEmailStatus('pending');

    try {
      const { data, error } = await supabase.functions.invoke('send-booking-confirmation', {
        body: { bookingId: bookingDetails.id }  
      });

      if (error) {
        throw new Error(error.message || "Failed to reach the email service.");
      } 
      
      if (data && data.success === false) {
        throw new Error(data.error || "Email provider rejected the request.");
      }

      setEmailStatus('sent');
      toast({ 
        title: 'Email Sent Successfully', 
        description: `Confirmation dispatched to ${bookingDetails.email}`,
      });
    } catch (error) {
      console.error("Exception resending email:", error);
      setEmailStatus('failed');
      setEmailErrorMsg(error.message);
      toast({
        title: 'Email Delivery Failed',
        description: error.message || 'Please verify the email address is correct or try again later.',
        variant: 'destructive',
      });
    } finally {
      setResendingEmail(false);
    }
  };

  const handleGoToPortal = () => {
    const portalId = bookingDetails?.customers?.customer_id_text || '';
    const phone = bookingDetails?.customers?.phone || bookingDetails?.phone || '';
    navigate(`/portal?portal_id=${encodeURIComponent(portalId)}&phone=${encodeURIComponent(phone)}`);
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-[60vh] no-print">
        <Loader2 className="h-16 w-16 animate-spin text-blue-400 mb-4" />
        <p className="text-white text-xl font-medium">Retrieving your booking confirmation...</p>
      </div>
    );
  }

  // Fallback if booking details completely failed to load
  if (errorMsg || !bookingId || !bookingDetails) {
    return (
      <div className="container mx-auto px-4 py-16 flex flex-col items-center no-print">
        <div className="bg-white/10 backdrop-blur-md p-8 rounded-2xl border border-white/20 shadow-2xl max-w-2xl w-full text-center">
          <AlertTriangle className="h-16 w-16 text-amber-400 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-white mb-4">Booking Details Unavailable</h1>
          <p className="text-gray-300 mb-4">{errorMsg}</p>
          <div className="flex gap-4 justify-center mt-6">
            <Button onClick={() => window.location.reload()} variant="outline" className="text-blue-300 border-blue-400 hover:bg-blue-500 hover:text-white">
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
            <Button asChild className="bg-blue-600 hover:bg-blue-700 text-white">
              <Link to="/"><Home className="mr-2 h-5 w-5" />Return to Homepage</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const deliveryAddress = bookingDetails.delivery_address || bookingDetails.contact_address || {};
  const formattedAddress = `${deliveryAddress.street || bookingDetails.street || 'N/A'}, ${deliveryAddress.city || bookingDetails.city || 'N/A'}, ${deliveryAddress.state || bookingDetails.state || 'N/A'} ${deliveryAddress.zip || bookingDetails.zip || 'N/A'}`;
  
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return dateString;
    }
  };

  const serviceName = serviceDetails?.name || bookingDetails.plan?.name || 'N/A';
  const isTrailer = serviceName.toLowerCase().includes('trailer');

  return (
    <>
      <div className="container mx-auto px-4 py-16 flex flex-col items-center no-print">
        <div className="bg-slate-900/80 backdrop-blur-md p-8 rounded-2xl border border-white/20 shadow-2xl max-w-3xl w-full text-center">
          
          <div className="flex justify-center mb-6">
            <div className="h-24 w-24 bg-green-500/20 rounded-full flex items-center justify-center border-4 border-green-400">
              <CheckCircle className="w-12 h-12 text-green-400" />
            </div>
          </div>
          
          <h1 className="text-4xl font-bold text-white mb-4">Booking Confirmed!</h1>
          <p className="text-xl text-blue-200 mb-8">Thank you for choosing U-Fill Dumpsters. Your order #{bookingDetails.id} is secured.</p>

          {/* Email Status Alert */}
          <div className={`p-5 rounded-xl mb-8 text-left flex items-start shadow-lg transition-all duration-500 ${
            emailStatus === 'sent' 
              ? 'bg-green-950/40 border border-green-500/40' 
              : emailStatus === 'failed'
              ? 'bg-red-950/40 border border-red-500/40'
              : 'bg-blue-950/40 border border-blue-500/40'
          }`}>
            {emailStatus === 'pending' ? (
              <Loader2 className="h-6 w-6 mr-4 flex-shrink-0 mt-0.5 text-blue-400 animate-spin" />
            ) : (
              <Mail className={`h-6 w-6 mr-4 flex-shrink-0 mt-0.5 ${emailStatus === 'sent' ? 'text-green-400' : 'text-red-400'}`} />
            )}
            
            <div className="flex-1">
              <p className={`font-bold mb-1 ${emailStatus === 'sent' ? 'text-green-300' : emailStatus === 'failed' ? 'text-red-300' : 'text-blue-300'}`}>
                {emailStatus === 'sent' ? '✓ Confirmation Email Sent' : emailStatus === 'failed' ? '⚠ Email Delivery Issue' : 'Sending Confirmation Email...'}
              </p>
              <p className={`text-sm mb-3 ${emailStatus === 'sent' ? 'text-green-100/80' : emailStatus === 'failed' ? 'text-red-100/80' : 'text-blue-100/80'}`}>
                {emailStatus === 'sent' 
                  ? `A detailed confirmation has been sent to ${bookingDetails.email}.` 
                  : emailStatus === 'failed' 
                  ? `We encountered an issue dispatching your email: ${emailErrorMsg || 'Unknown error'}. Your booking is still confirmed. You can safely print your receipt or try resending.`
                  : 'We are currently dispatching your confirmation email in the background. Your booking details are available below.'}
              </p>
              {emailStatus === 'failed' && (
                <Button 
                  onClick={handleResendEmail} 
                  disabled={resendingEmail} 
                  size="sm" 
                  variant="outline" 
                  className="bg-red-950/50 text-red-200 border-red-500/30 hover:bg-red-900 hover:text-white"
                >
                  {resendingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  {resendingEmail ? 'Sending...' : 'Retry Sending Email'}
                </Button>
              )}
            </div>
          </div>

          {/* Booking Details - ALWAYS VISIBLE once loaded, regardless of email status */}
          <div className="bg-black/40 p-6 rounded-xl mb-8 text-left space-y-4 shadow-lg border border-white/10">
            <h3 className="text-xl font-bold text-white border-b border-white/10 pb-3 mb-4 flex items-center">
               Booking Summary
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
                <div>
                  <p className="text-white mb-2"><span className="text-blue-300/80 font-semibold w-24 inline-block">Order ID:</span> <span className="text-lg font-bold text-green-400">#{bookingDetails.id}</span></p>
                  <p className="text-white mb-2"><span className="text-blue-300/80 font-semibold w-24 inline-block">Customer:</span> {bookingDetails.name || `${bookingDetails.first_name} ${bookingDetails.last_name}`}</p>
                  <p className="text-white mb-2"><span className="text-blue-300/80 font-semibold w-24 inline-block">Email:</span> {bookingDetails.email}</p>
                  <p className="text-white mb-2"><span className="text-blue-300/80 font-semibold w-24 inline-block">Phone:</span> {bookingDetails.phone}</p>
                </div>
                <div>
                  <p className="text-white mb-2"><span className="text-blue-300/80 font-semibold w-24 inline-block">Service:</span> {serviceName}</p>
                  <p className="text-white mb-2"><span className="text-blue-300/80 font-semibold w-24 inline-block">Total Paid:</span> <span className="font-bold text-green-400">${(bookingDetails.total_price || 0).toFixed(2)}</span></p>
                </div>
            </div>
            
            <div className="mt-6 pt-4 border-t border-white/10">
              <p className="text-white flex items-start mb-3">
                <Calendar className="h-5 w-5 text-blue-400 mr-3 mt-0.5 flex-shrink-0"/>
                <span>
                  <strong className="text-blue-100">{isTrailer ? 'Pickup Start:' : 'Delivery Date:'}</strong> {formatDate(bookingDetails.drop_off_date)} ({bookingDetails.drop_off_time_slot || 'Anytime'})<br/>
                  <strong className="text-blue-100">{isTrailer ? 'Return Deadline:' : 'Pickup Date:'}</strong> {formatDate(bookingDetails.pickup_date)} ({bookingDetails.pickup_time_slot || 'Anytime'})
                </span>
              </p>
              {!isTrailer && (
                <p className="text-white flex items-start">
                  <MapPin className="h-5 w-5 text-blue-400 mr-3 mt-0.5 flex-shrink-0"/>
                  <span className="break-words"><strong className="text-blue-100">Address:</strong> {formattedAddress}</span>
                </p>
              )}
            </div>
          </div>

          <div className="bg-gradient-to-br from-yellow-900/40 to-yellow-800/20 border border-yellow-500/30 p-6 rounded-xl mb-8 text-left shadow-lg">
            <h3 className="text-xl font-bold text-yellow-400 mb-2 flex items-center"><Key className="mr-2 h-5 w-5" /> Secure Customer Portal</h3>
            <p className="text-yellow-100/80 text-sm mb-5">Use these credentials to log in anytime to view your receipt, manage your booking dates, or add notes for our team.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-black/50 p-4 rounded-lg border border-yellow-700/30">
                <p className="text-xs text-yellow-500/80 uppercase tracking-wider mb-1 font-semibold">Portal ID</p>
                <p className="text-xl font-mono font-bold text-white tracking-widest">{bookingDetails.customers?.customer_id_text || 'N/A'}</p>
              </div>
              <div className="bg-black/50 p-4 rounded-lg border border-yellow-700/30">
                <p className="text-xs text-yellow-500/80 uppercase tracking-wider mb-1 font-semibold">Phone Number</p>
                <p className="text-xl font-mono font-bold text-white tracking-widest">{bookingDetails.customers?.phone || bookingDetails.phone || 'N/A'}</p>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 w-full mt-10">
            <Button onClick={handleGoToPortal} className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-6 flex-1 text-lg border-none">
              <Key className="mr-2 h-5 w-5" /> Access Portal
            </Button>
            <Button onClick={handlePrint} variant="outline" className="bg-white/5 border-blue-400/50 text-blue-100 hover:bg-blue-500 hover:text-white hover:border-blue-500 font-semibold py-6 flex-1 text-lg transition-colors">
              <Printer className="mr-2 h-5 w-5" /> Save / Print Receipt
            </Button>
            <Button asChild className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-6 flex-1 text-lg border-none">
              <Link to="/"><Home className="mr-2 h-5 w-5" /> Back to Home</Link>
            </Button>
          </div>
          
        </div>
      </div>

      <div style={{ display: 'none' }}>
        <div ref={receiptRef}>
          <PrintableReceipt booking={bookingDetails} />
        </div>
      </div>
    </>
  );
}