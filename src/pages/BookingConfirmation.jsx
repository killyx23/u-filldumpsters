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

export default function BookingConfirmation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Stripe appends these automatically to your return_url after Payment Element redirect:
  //   ?payment_intent=pi_xxx&payment_intent_client_secret=pi_xxx_secret_xxx&redirect_status=succeeded
  // We also pass booking_id ourselves in the return_url.
  const bookingId            = searchParams.get('booking_id');
  const paymentIntentId      = searchParams.get('payment_intent');
  const redirectStatus       = searchParams.get('redirect_status');

  const [loading, setLoading]               = useState(true);
  const [bookingDetails, setBookingDetails] = useState(null);
  const [serviceDetails, setServiceDetails] = useState(null);

  // finalize state: 'pending' | 'done' | 'failed'
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

  // ------------------------------------------------------------------
  // Finalize booking — calls the edge function with the payment_intent
  // id that Stripe placed in the URL. Safe to retry.
  // ------------------------------------------------------------------
  const finalizeBooking = async ({ isRetry = false } = {}) => {
    if (!bookingId) return;

    if (isRetry) {
      setIsRefinalizing(true);
      setFinalizeError('');
      setFinalizeStatus('pending');
    }

    try {
      const { data, error } = await supabase.functions.invoke('finalize-booking', {
        body: {
          bookingId,
          paymentIntentId, // pi_xxx from Stripe's return_url — may be null if redirect didn't happen
        },
      });

      if (error) throw new Error(error.message);
      if (data?.success === false) throw new Error(data.error ?? 'Finalization failed.');

      setFinalizeStatus('done');
    } catch (err) {
      console.error('[BookingConfirmation] finalize-booking error:', err);
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

  // ------------------------------------------------------------------
  // On mount: fetch booking details, then kick off finalization
  // ------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    if (!bookingId) {
      setErrorMsg('Booking ID is missing from the URL. Cannot retrieve details.');
      setLoading(false);
      return;
    }

    // Warn if Stripe redirect indicated failure before we even try
    if (redirectStatus && redirectStatus !== 'succeeded') {
      setErrorMsg(
        `Payment did not complete successfully (status: ${redirectStatus}). ` +
        `Please go back and try again.`
      );
      setLoading(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      if (isMounted && loading) {
        setErrorMsg('Loading timed out. Please check your connection or refresh.');
        setLoading(false);
      }
    }, 15000);

    const fetchAndFinalize = async () => {
      try {
        // 1. Fetch booking display data
        const { data: booking, error: fetchError } = await supabase
          .from('bookings')
          .select('*, customers(*)')
          .eq('id', bookingId)
          .single();

        if (fetchError || !booking) {
          throw new Error(fetchError?.message ?? 'Could not find the requested booking.');
        }

        if (!isMounted) return;
        setBookingDetails(booking);

        // 2. Resolve service details for display
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

          if (service && isMounted) setServiceDetails(service);
        }

        setLoading(false);
        clearTimeout(timeoutId);

        // 3. Finalize booking in the background (Stripe IDs, status, email)
        //    Don't await — let the UI show immediately while this runs.
        finalizeBooking();

      } catch (err) {
        console.error('[BookingConfirmation] fetchAndFinalize error:', err);
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

  const handleGoToPortal = () => {
    const portalId = bookingDetails?.customers?.customer_id_text ?? '';
    const phone    = bookingDetails?.customers?.phone ?? bookingDetails?.phone ?? '';
    navigate(`/portal?portal_id=${encodeURIComponent(portalId)}&phone=${encodeURIComponent(phone)}`);
  };

  // ------------------------------------------------------------------
  // Loading / error states
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
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
  const isTrailer   = serviceName.toLowerCase().includes('trailer');

  // ------------------------------------------------------------------
  // Finalization status banner
  // ------------------------------------------------------------------
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
            : 'Finalizing your booking...'}
        </p>

        <p className={`text-sm mb-3 ${
          finalizeStatus === 'done' ? 'text-green-100/80'
          : finalizeStatus === 'failed' ? 'text-red-100/80'
          : 'text-blue-100/80'
        }`}>
          {finalizeStatus === 'done'
            ? `A confirmation email has been sent to ${bookingDetails.email}. Your booking is secured.`
            : finalizeStatus === 'failed'
            ? `We encountered an issue finalizing your booking: ${finalizeError}. Your payment was captured — please contact us if this persists.`
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
              : <><RefreshCw className="mr-2 h-4 w-4" />Retry Finalization</>}
          </Button>
        )}
      </div>
    </div>
  );

  // ------------------------------------------------------------------
  // Main render
  // ------------------------------------------------------------------
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

          {/* Finalization status banner */}
          <FinalizeBanner />

          {/* Booking details — always visible once loaded */}
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
                  <span className="text-blue-300/80 font-semibold w-24 inline-block">Total Paid:</span>
                  <span className="font-bold text-green-400">${(bookingDetails.total_price || 0).toFixed(2)}</span>
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/10">
              <p className="text-white flex items-start mb-3">
                <Calendar className="h-5 w-5 text-blue-400 mr-3 mt-0.5 flex-shrink-0" />
                <span>
                  <strong className="text-blue-100">{isTrailer ? 'Pickup Start:' : 'Delivery Date:'}</strong>{' '}
                  {formatDate(bookingDetails.drop_off_date)} ({bookingDetails.drop_off_time_slot || 'Anytime'})<br />
                  <strong className="text-blue-100">{isTrailer ? 'Return Deadline:' : 'Pickup Date:'}</strong>{' '}
                  {formatDate(bookingDetails.pickup_date)} ({bookingDetails.pickup_time_slot || 'Anytime'})
                </span>
              </p>
              {!isTrailer && (
                <p className="text-white flex items-start">
                  <MapPin className="h-5 w-5 text-blue-400 mr-3 mt-0.5 flex-shrink-0" />
                  <span className="break-words">
                    <strong className="text-blue-100">Address:</strong> {formattedAddress}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* Portal credentials */}
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

          {/* Action buttons */}
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
