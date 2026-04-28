
import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle, Home, AlertTriangle, Calendar, MapPin,
  Mail, Loader2, RefreshCw, Key, Printer
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';
import { formatTimeWindow, shouldShowTimeWindow, isSelfServiceTrailer } from '@/utils/timeWindowFormatter';
import { createTaxRecord } from '@/utils/createTaxRecord';

export default function BookingConfirmation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const bookingId            = searchParams.get('booking_id');
  const paymentIntentId      = searchParams.get('payment_intent');
  const redirectStatus       = searchParams.get('redirect_status');

  const [loading, setLoading]               = useState(true);
  const [bookingDetails, setBookingDetails] = useState(null);
  const [serviceDetails, setServiceDetails] = useState(null);

  const [finalizeStatus, setFinalizeStatus]   = useState('pending');
  const [finalizeError, setFinalizeError]     = useState('');
  const [isRefinalizing, setIsRefinalizing]   = useState(false);

  const [errorMsg, setErrorMsg] = useState(null);

  const receiptRef = useRef();

  const handlePrint = useReactToPrint({
    content: () => receiptRef.current,
    documentTitle: `Receipt-Booking-${bookingId}`,
    removeAfterPrint: true,
  });

  // Finalize booking with comprehensive logging and tax record creation
  const finalizeBooking = async ({ isRetry = false } = {}) => {
    if (!bookingId) {
      console.warn('[BookingConfirmation] Cannot finalize: missing bookingId');
      return;
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BookingConfirmation] Starting finalization`, {
      bookingId,
      paymentIntentId,
      isRetry
    });

    if (isRetry) {
      setIsRefinalizing(true);
      setFinalizeError('');
      setFinalizeStatus('pending');
    }

    try {
      console.log(`[${timestamp}] [BookingConfirmation] Calling finalize-booking edge function...`);
      
      const { data, error } = await supabase.functions.invoke('finalize-booking', {
        body: {
          bookingId,
          paymentIntentId,
        },
      });

      console.log(`[${timestamp}] [BookingConfirmation] Edge function response:`, {
        data,
        error,
        hasError: !!error,
        dataSuccess: data?.success
      });

      if (error) {
        console.error(`[${timestamp}] [BookingConfirmation] Edge function error:`, error);
        throw new Error(error.message);
      }
      
      if (data?.success === false) {
        console.error(`[${timestamp}] [BookingConfirmation] Finalization failed:`, data.error);
        throw new Error(data.error ?? 'Finalization failed.');
      }

      console.log(`[${timestamp}] [BookingConfirmation] ✓ Finalization successful`, {
        emailSent: data?.emailSent,
        bookingUpdated: data?.bookingUpdated
      });

      // Create tax record for audit tracking
      if (data?.bookingData) {
        console.log(`[${timestamp}] [BookingConfirmation] Creating tax record...`);
        
        const taxResult = await createTaxRecord(
          bookingId,
          data.bookingData.tax_amount,
          data.bookingData.tax_rate_used,
          data.bookingData.subtotal_before_tax
        );

        if (taxResult.success) {
          console.log(`[${timestamp}] [BookingConfirmation] ✓ Tax record created:`, taxResult.taxRecord.id);
        } else {
          console.warn(`[${timestamp}] [BookingConfirmation] ⚠ Tax record creation failed:`, taxResult.error);
        }
      }

      setFinalizeStatus('done');

      if (data?.emailSent) {
        console.log(`[${timestamp}] [BookingConfirmation] ✓ Confirmation email sent successfully`);
        toast({
          title: 'Email Sent',
          description: 'A confirmation email has been sent to your inbox.',
        });
      } else {
        console.warn(`[${timestamp}] [BookingConfirmation] ⚠ Email was not sent`, data);
      }

    } catch (err) {
      const errorTimestamp = new Date().toISOString();
      console.error(`[${errorTimestamp}] [BookingConfirmation] Finalization error:`, {
        error: err,
        message: err.message,
        stack: err.stack
      });

      setFinalizeStatus('failed');
      setFinalizeError(err.message ?? 'Unknown error during finalization.');
      
      if (isRetry) {
        toast({
          title: 'Finalization Failed',
          description: err.message,
          variant: 'destructive',
        });
      }
    } finally {
      if (isRetry) setIsRefinalizing(false);
    }
  };

  // Fetch booking with comprehensive logging
  useEffect(() => {
    let isMounted = true;

    if (!bookingId) {
      console.error('[BookingConfirmation] Missing booking ID in URL');
      setErrorMsg('Booking ID is missing from the URL. Cannot retrieve details.');
      setLoading(false);
      return;
    }

    console.log('[BookingConfirmation] Initializing with params:', {
      bookingId,
      paymentIntentId,
      redirectStatus
    });

    if (redirectStatus && redirectStatus !== 'succeeded') {
      console.error('[BookingConfirmation] Payment redirect status is not succeeded:', redirectStatus);
      setErrorMsg(
        `Payment did not complete successfully (status: ${redirectStatus}). ` +
        `Please go back and try again.`
      );
      setLoading(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      if (isMounted && loading) {
        console.error('[BookingConfirmation] Loading timeout after 15 seconds');
        setErrorMsg('Loading timed out. Please check your connection or refresh.');
        setLoading(false);
      }
    }, 15000);

    const fetchAndFinalize = async () => {
      const timestamp = new Date().toISOString();
      
      try {
        console.log(`[${timestamp}] [BookingConfirmation] Fetching booking data for ID: ${bookingId}`);

        const { data: booking, error: fetchError } = await supabase
          .from('bookings')
          .select('*, customers(*)')
          .eq('id', bookingId)
          .single();

        console.log(`[${timestamp}] [BookingConfirmation] Booking fetch result:`, {
          hasData: !!booking,
          hasError: !!fetchError,
          error: fetchError,
          bookingStatus: booking?.status,
          customerId: booking?.customer_id,
          customerData: booking?.customers,
          hasTaxData: !!(booking?.tax_amount && booking?.tax_rate_used)
        });

        if (fetchError || !booking) {
          console.error(`[${timestamp}] [BookingConfirmation] Booking fetch failed:`, fetchError);
          throw new Error(fetchError?.message ?? 'Could not find the requested booking.');
        }

        if (!isMounted) return;
        
        console.log(`[${timestamp}] [BookingConfirmation] ✓ Booking data loaded successfully:`, {
          id: booking.id,
          email: booking.email,
          status: booking.status,
          tax_amount: booking.tax_amount,
          tax_rate_used: booking.tax_rate_used,
          subtotal_before_tax: booking.subtotal_before_tax,
          customer_portal_id: booking.customers?.customer_id_text,
          customer_phone: booking.customers?.phone
        });

        setBookingDetails(booking);

        let resolvedServiceId = booking.plan?.service_id || booking.plan?.id;
        if (booking.addons?.deliveryService && resolvedServiceId === 2) {
          resolvedServiceId = 4;
        }

        if (resolvedServiceId) {
          console.log(`[${timestamp}] [BookingConfirmation] Fetching service details for ID: ${resolvedServiceId}`);
          
          const { data: service } = await supabase
            .from('services')
            .select('*')
            .eq('id', resolvedServiceId)
            .single();

          if (service && isMounted) {
            console.log(`[${timestamp}] [BookingConfirmation] ✓ Service data loaded:`, service.name);
            setServiceDetails(service);
          }
        }

        setLoading(false);
        clearTimeout(timeoutId);

        console.log(`[${timestamp}] [BookingConfirmation] Triggering finalization process...`);
        finalizeBooking();

      } catch (err) {
        const errorTimestamp = new Date().toISOString();
        console.error(`[${errorTimestamp}] [BookingConfirmation] fetchAndFinalize error:`, {
          error: err,
          message: err.message,
          stack: err.stack
        });
        
        if (isMounted) {
          setErrorMsg(err.message);
          setLoading(false);
        }
      }
    };

    fetchAndFinalize();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  // Portal access with retry logic and comprehensive logging
  const handleGoToPortal = async () => {
    const timestamp = new Date().toISOString();
    const portalId = bookingDetails?.customers?.customer_id_text ?? '';
    const phone    = bookingDetails?.customers?.phone ?? bookingDetails?.phone ?? '';

    console.log(`[${timestamp}] [BookingConfirmation] Portal access initiated`, {
      portalId,
      phone,
      hasCustomerData: !!bookingDetails?.customers,
      customerId: bookingDetails?.customer_id
    });

    if (!portalId || !phone) {
      console.error(`[${timestamp}] [BookingConfirmation] ⚠ Missing portal credentials`, {
        portalId,
        phone
      });
      
      toast({
        title: 'Portal Access Error',
        description: 'Missing portal credentials. Please contact support.',
        variant: 'destructive'
      });
      return;
    }

    console.log(`[${timestamp}] [BookingConfirmation] Waiting 500ms for data commit...`);
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      console.log(`[${timestamp}] [BookingConfirmation] Verifying customer exists in database...`);
      
      const { data: customer, error } = await supabase
        .from('customers')
        .select('id, customer_id_text, phone, email')
        .eq('customer_id_text', portalId)
        .single();

      console.log(`[${timestamp}] [BookingConfirmation] Customer verification result:`, {
        found: !!customer,
        error,
        customerId: customer?.id,
        portalId: customer?.customer_id_text
      });

      if (error || !customer) {
        console.error(`[${timestamp}] [BookingConfirmation] ⚠ Customer not found, adding retry delay...`);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const { data: retryCustomer, error: retryError } = await supabase
          .from('customers')
          .select('id, customer_id_text, phone, email')
          .eq('customer_id_text', portalId)
          .single();

        console.log(`[${timestamp}] [BookingConfirmation] Retry verification result:`, {
          found: !!retryCustomer,
          error: retryError
        });

        if (retryError || !retryCustomer) {
          throw new Error('Customer record not ready. Please wait a moment and try again.');
        }
      }

      console.log(`[${timestamp}] [BookingConfirmation] ✓ Customer verified, navigating to portal...`);
      
      navigate(`/portal?portal_id=${encodeURIComponent(portalId)}&phone=${encodeURIComponent(phone)}`);
      
    } catch (err) {
      console.error(`[${timestamp}] [BookingConfirmation] Portal navigation error:`, err);
      
      toast({
        title: 'Portal Access Delayed',
        description: 'Your account is being set up. Please wait 10 seconds and try again.',
        variant: 'destructive'
      });
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-[60vh] no-print">
        <Loader2 className="h-16 w-16 animate-spin text-blue-400 mb-4" />
        <p className="text-white text-xl font-medium">Retrieving your booking confirmation...</p>
      </div>
    );
  }

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

  const deliveryAddress  = bookingDetails.delivery_address || bookingDetails.contact_address || {};
  const formattedAddress = `${deliveryAddress.street || bookingDetails.street || 'N/A'}, ${deliveryAddress.city || bookingDetails.city || 'N/A'}, ${deliveryAddress.state || bookingDetails.state || 'N/A'} ${deliveryAddress.zip || bookingDetails.zip || 'N/A'}`;

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch { return dateString; }
  };

  const serviceName = serviceDetails?.name || bookingDetails.plan?.name || 'N/A';
  const isDelivery = bookingDetails.addons?.deliveryService || bookingDetails.addons?.isDelivery;
  
  // Time window formatting options
  const showTimeWindow = shouldShowTimeWindow(bookingDetails.plan, isDelivery);
  const isSelfService = isSelfServiceTrailer(bookingDetails.plan, isDelivery);
  const timeOptions = {
    isWindow: showTimeWindow,
    isSelfService: isSelfService,
    serviceType: bookingDetails.plan?.service_type
  };

  // Get tax information from booking record
  const taxRateUsed = bookingDetails.tax_rate_used || 7.45;
  const taxAmount = bookingDetails.tax_amount || 0;
  const subtotalBeforeTax = bookingDetails.subtotal_before_tax || 0;
  const totalPaid = bookingDetails.total_price || 0;

  // Finalization status banner
  const FinalizeBanner = () => (
    <div className={`p-5 rounded-xl mb-8 text-left flex items-start shadow-lg transition-all duration-500 ${
      finalizeStatus === 'done'
        ? 'bg-green-950/40 border border-green-500/40'
        : finalizeStatus === 'failed'
        ? 'bg-red-950/40 border border-red-500/40'
        : 'bg-blue-950/40 border border-blue-500/40'
    }`}>
      {finalizeStatus === 'pending' ? (
        <Loader2 className="h-6 w-6 mr-4 flex-shrink-0 mt-0.5 text-blue-400 animate-spin" />
      ) : (
        <Mail className={`h-6 w-6 mr-4 flex-shrink-0 mt-0.5 ${
          finalizeStatus === 'done' ? 'text-green-400' : 'text-red-400'
        }`} />
      )}

      <div className="flex-1">
        <p className={`font-bold mb-1 ${
          finalizeStatus === 'done' ? 'text-green-300'
          : finalizeStatus === 'failed' ? 'text-red-300'
          : 'text-blue-300'
        }`}>
          {finalizeStatus === 'done'
            ? '✓ Booking Confirmed & Email Sent'
            : finalizeStatus === 'failed'
            ? '⚠ Confirmation Issue'
            : 'Sending confirmation email...'}
        </p>

        <p className={`text-sm mb-3 ${
          finalizeStatus === 'done' ? 'text-green-100/80'
          : finalizeStatus === 'failed' ? 'text-red-100/80'
          : 'text-blue-100/80'
        }`}>
          {finalizeStatus === 'done'
            ? `A confirmation email has been sent to ${bookingDetails.email}. Your booking is secured.`
            : finalizeStatus === 'failed'
            ? `We encountered an issue sending your confirmation email: ${finalizeError}. Your payment was successful and booking is confirmed. You can access your receipt in the portal.`
            : 'Recording your payment and sending your confirmation email. This only takes a moment.'}
        </p>

        {finalizeStatus === 'failed' && (
          <Button
            onClick={() => finalizeBooking({ isRetry: true })}
            disabled={isRefinalizing}
            size="sm"
            variant="outline"
            className="bg-red-950/50 text-red-200 border-red-500/30 hover:bg-red-900 hover:text-white"
          >
            {isRefinalizing
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Retrying...</>
              : <><RefreshCw className="mr-2 h-4 w-4" />Retry Sending Email</>}
          </Button>
        )}
      </div>
    </div>
  );

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
          <p className="text-xl text-blue-200 mb-8">
            Thank you for choosing U-Fill Dumpsters. Your order #{bookingDetails.id} is secured.
          </p>

          <FinalizeBanner />

          <div className="bg-black/40 p-6 rounded-xl mb-8 text-left space-y-4 shadow-lg border border-white/10">
            <h3 className="text-xl font-bold text-white border-b border-white/10 pb-3 mb-4 flex items-center">
              Booking Summary
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
              <div>
                <p className="text-white mb-2">
                  <span className="text-blue-300/80 font-semibold w-24 inline-block">Order ID:</span>
                  <span className="text-lg font-bold text-green-400">#{bookingDetails.id}</span>
                </p>
                <p className="text-white mb-2">
                  <span className="text-blue-300/80 font-semibold w-24 inline-block">Customer:</span>
                  {bookingDetails.name || `${bookingDetails.first_name} ${bookingDetails.last_name}`}
                </p>
                <p className="text-white mb-2">
                  <span className="text-blue-300/80 font-semibold w-24 inline-block">Email:</span>
                  {bookingDetails.email}
                </p>
                <p className="text-white mb-2">
                  <span className="text-blue-300/80 font-semibold w-24 inline-block">Phone:</span>
                  {bookingDetails.phone}
                </p>
              </div>
              <div>
                <p className="text-white mb-2">
                  <span className="text-blue-300/80 font-semibold w-24 inline-block">Service:</span>
                  {serviceName}
                </p>
                <p className="text-white mb-2">
                  <span className="text-blue-300/80 font-semibold w-32 inline-block">Subtotal:</span>
                  <span className="font-bold">${subtotalBeforeTax.toFixed(2)}</span>
                </p>
                <p className="text-white mb-2">
                  <span className="text-blue-300/80 font-semibold w-32 inline-block">Tax ({taxRateUsed.toFixed(2)}%):</span>
                  <span className="font-bold">${taxAmount.toFixed(2)}</span>
                </p>
                <p className="text-white mb-2">
                  <span className="text-blue-300/80 font-semibold w-32 inline-block">Total Paid:</span>
                  <span className="font-bold text-green-400">${totalPaid.toFixed(2)}</span>
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/10">
              <p className="text-white flex items-start mb-3">
                <Calendar className="h-5 w-5 text-blue-400 mr-3 mt-0.5 flex-shrink-0" />
                <span>
                  <strong className="text-blue-100">{isSelfService ? 'Pickup Start:' : 'Delivery Date:'}</strong>{' '}
                  {formatDate(bookingDetails.drop_off_date)} ({formatTimeWindow(bookingDetails.drop_off_time_slot, timeOptions)})<br />
                  <strong className="text-blue-100">{isSelfService ? 'Return Deadline:' : 'Pickup Date:'}</strong>{' '}
                  {formatDate(bookingDetails.pickup_date)} ({formatTimeWindow(bookingDetails.pickup_time_slot, timeOptions)})
                </span>
              </p>
              {!isSelfService && (
                <p className="text-white flex items-start">
                  <MapPin className="h-5 w-5 text-blue-400 mr-3 mt-0.5 flex-shrink-0" />
                  <span className="break-words">
                    <strong className="text-blue-100">Address:</strong> {formattedAddress}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="bg-gradient-to-br from-yellow-900/40 to-yellow-800/20 border border-yellow-500/30 p-6 rounded-xl mb-8 text-left shadow-lg">
            <h3 className="text-xl font-bold text-yellow-400 mb-2 flex items-center">
              <Key className="mr-2 h-5 w-5" /> Secure Customer Portal
            </h3>
            <p className="text-yellow-100/80 text-sm mb-5">
              Use these credentials to log in anytime to view your receipt, manage booking dates, or add notes for our team.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-black/50 p-4 rounded-lg border border-yellow-700/30">
                <p className="text-xs text-yellow-500/80 uppercase tracking-wider mb-1 font-semibold">Portal ID</p>
                <p className="text-xl font-mono font-bold text-white tracking-widest">
                  {bookingDetails.customers?.customer_id_text ?? 'N/A'}
                </p>
              </div>
              <div className="bg-black/50 p-4 rounded-lg border border-yellow-700/30">
                <p className="text-xs text-yellow-500/80 uppercase tracking-wider mb-1 font-semibold">Phone Number</p>
                <p className="text-xl font-mono font-bold text-white tracking-widest">
                  {bookingDetails.customers?.phone ?? bookingDetails.phone ?? 'N/A'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full mt-10">
            <Button
              onClick={handleGoToPortal}
              className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-6 flex-1 text-lg border-none"
            >
              <Key className="mr-2 h-5 w-5" /> Access Portal
            </Button>
            <Button
              onClick={handlePrint}
              variant="outline"
              className="bg-white/5 border-blue-400/50 text-blue-100 hover:bg-blue-500 hover:text-white hover:border-blue-500 font-semibold py-6 flex-1 text-lg transition-colors"
            >
              <Printer className="mr-2 h-5 w-5" /> Save / Print Receipt
            </Button>
            <Button
              asChild
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-6 flex-1 text-lg border-none"
            >
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
