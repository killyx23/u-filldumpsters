import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle, Home, AlertTriangle, Calendar, MapPin,
  Mail, Loader2, RefreshCw, Key, Printer, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';
import { PickupLocationInfoButton } from '@/components/customer-portal/PickupLocationInfoButton';
import { formatTimeWindow, shouldShowTimeWindow, isSelfServiceTrailer } from '@/utils/timeWindowFormatter';
import { createTaxRecord } from '@/utils/createTaxRecord';
import { formatBookingDateOnly } from '@/utils/bookingDateFormatter';
import { resolveBookingGrandTotal } from '@/utils/resolveBookingGrandTotal';
import { buildAccessCodesQrUrl } from '@/utils/buildPortalQrUrls';

export const BookingConfirmation = () => {
  const [searchParams] = useSearchParams();

  const bookingId            = searchParams.get('booking_id');
  const paymentIntentId      = searchParams.get('payment_intent');
  const redirectStatus       = searchParams.get('redirect_status');

  const [loading, setLoading]               = useState(true);
  const [bookingDetails, setBookingDetails] = useState(null);
  const [serviceDetails, setServiceDetails] = useState(null);

  const [finalizeStatus, setFinalizeStatus]   = useState('pending');
  const [finalizeError, setFinalizeError]     = useState('');
  const [isRefinalizing, setIsRefinalizing]   = useState(false);

  const [magicLinkUrl, setMagicLinkUrl] = useState('');
  const [generatingMagicLink, setGeneratingMagicLink] = useState(false);

  const [errorMsg, setErrorMsg] = useState(null);
  const [pointsAwarded, setPointsAwarded] = useState(0);
  const [referralPendingAward, setReferralPendingAward] = useState(0);
  const [isPortalNavigating, setIsPortalNavigating] = useState(false);

  const navigate = useNavigate();
  const receiptRef = useRef();

  const handlePrint = useReactToPrint({
    content: () => receiptRef.current,
    documentTitle: `Receipt-Booking-${bookingId}`,
    removeAfterPrint: true,
  });

  const generateMagicLink = async (customerId, customerPhone, portalNumber) => {
    const timestamp = new Date().toISOString();

    console.log(`[${timestamp}] [BookingConfirmation] Generating magic link token for customer:`, {
      customer_id: customerId,
      phone: customerPhone
    });

    setGeneratingMagicLink(true);

    try {
      console.log(`[${timestamp}] [BookingConfirmation] Calling generate-magic-link-token edge function...`);

      const { data, error } = await supabase.functions.invoke('generate-magic-link-token', {
        body: {
          customer_id: customerId,
          phone: customerPhone,
          order_id: bookingId,
        }
      });

      console.log(`[${timestamp}] [BookingConfirmation] Magic link token response:`, {
        success: !!data,
        error,
        hasToken: !!data?.token
      });

      if (error) {
        console.error(`[${timestamp}] [BookingConfirmation] Magic link generation error:`, error);
        throw error;
      }

      if (data?.token) {
        const url = buildAccessCodesQrUrl({
          token: data.token,
          portalNumber,
          phone: customerPhone,
          orderId: bookingId,
        });

        console.log(`[${timestamp}] [BookingConfirmation] Magic link created:`, url);
        setMagicLinkUrl(url);
      }
    } catch (err) {
      console.error(`[${timestamp}] [BookingConfirmation] Failed to generate magic link:`, {
        error: err.message,
        stack: err.stack
      });

      const fallbackUrl = buildAccessCodesQrUrl({
        portalNumber,
        phone: customerPhone,
        orderId: bookingId,
      });
      console.log(`[${timestamp}] [BookingConfirmation] Using fallback URL:`, fallbackUrl);
      setMagicLinkUrl(fallbackUrl);
    } finally {
      setGeneratingMagicLink(false);
    }
  };

  const resendConfirmationEmail = async () => {
    if (!bookingId) return false;

    setIsRefinalizing(true);
    setFinalizeError('');

    try {
      const { data, error } = await supabase.functions.invoke('resend-confirmation-email', {
        body: {
          booking_id: bookingId,
          site_url: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      });

      if (error) {
        const errContext = await error.context?.json().catch(() => null);
        throw new Error(errContext?.error || error.message);
      }
      if (!data?.success) {
        throw new Error(data?.error || data?.details || 'Failed to resend confirmation email.');
      }

      setFinalizeStatus('done');
      toast({
        title: 'Email Sent',
        description: 'A confirmation email has been sent to your inbox.',
      });
      return true;
    } catch (err) {
      console.error('[BookingConfirmation] Resend confirmation email error:', err);
      setFinalizeStatus('email_failed');
      setFinalizeError(err.message || 'Could not send confirmation email.');
      toast({
        title: 'Email Failed',
        description: err.message || 'Could not send confirmation email.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsRefinalizing(false);
    }
  };

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
          site_url: typeof window !== 'undefined' ? window.location.origin : undefined,
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

      if (data?.booking) {
        setBookingDetails((prev) => ({
          ...prev,
          ...data.booking,
          customers: data.booking.customers ?? prev?.customers,
        }));
      }

      const bookingForTax = data?.booking ?? data?.bookingData;
      if (bookingForTax) {
        console.log(`[${timestamp}] [BookingConfirmation] Creating tax record...`);
        
        const taxResult = await createTaxRecord(
          bookingId,
          Number(bookingForTax.tax_amount || 0),
          Number(bookingForTax.tax_rate_used || 0),
          Number(bookingForTax.subtotal_before_tax || 0),
          bookingForTax
        );

        if (taxResult.success) {
          console.log(`[${timestamp}] [BookingConfirmation] ✓ Tax record created:`, taxResult.taxRecord.id);
        } else {
          console.warn(`[${timestamp}] [BookingConfirmation] ⚠ Tax record creation failed:`, taxResult.error);
        }
      }

      if (data?.emailSent) {
        setFinalizeStatus('done');
        console.log(`[${timestamp}] [BookingConfirmation] ✓ Confirmation email sent successfully`);
        toast({
          title: 'Email Sent',
          description: 'A confirmation email has been sent to your inbox.',
        });
      } else {
        setFinalizeStatus('email_failed');
        setFinalizeError(data?.emailError || 'Confirmation email could not be sent.');
        console.warn(`[${timestamp}] [BookingConfirmation] ⚠ Email was not sent`, data);
      }

      const awardedFromFinalize = Number(data?.loyalty?.pointsAwarded || 0);
      if (awardedFromFinalize > 0) {
        setPointsAwarded(awardedFromFinalize);
        toast({
          title: 'Loyalty Points Earned!',
          description: `You earned ${awardedFromFinalize} points with this booking!`,
        });
      }
      const pendingReferralFromFinalize = Number(data?.booking?.addons?.referralDollarsPending || 0);
      if (pendingReferralFromFinalize > 0) {
        setReferralPendingAward(pendingReferralFromFinalize);
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

        const { data: payload, error: fetchError } = await supabase.rpc('get_booking_for_post_checkout', {
          p_booking_id: Number.parseInt(String(bookingId), 10),
          p_payment_intent: paymentIntentId || null,
        });

        if (fetchError || !payload?.booking) {
          console.error(`[${timestamp}] [BookingConfirmation] Booking fetch failed:`, fetchError);
          throw new Error(fetchError?.message ?? 'Could not find the requested booking.');
        }

        const booking = {
          ...payload.booking,
          customers: payload.customers,
        };

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

        const serviceName = booking.plan?.name || '';
        const isDumpLoaderRental =
          serviceName.toLowerCase().includes('dump loader') ||
          serviceName.toLowerCase().includes('trailer') ||
          parseInt(booking.plan?.id) === 2;

        if (isDumpLoaderRental && booking.customers?.id && booking.customers?.phone) {
          console.log(`[${timestamp}] [BookingConfirmation] This is Dump Loader Trailer - generating magic link`);
          await generateMagicLink(
            booking.customers.id,
            booking.customers.phone,
            booking.customers.customer_id_text
          );
        }

        setLoading(false);
        clearTimeout(timeoutId);

        console.log(`[${timestamp}] [BookingConfirmation] Triggering finalization process...`);
        await finalizeBooking();

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

  const handleGoToPortal = async () => {
    const timestamp = new Date().toISOString();

    const resolvePortalCredentials = async () => {
      let portalId = bookingDetails?.customers?.customer_id_text ?? '';
      let phone = bookingDetails?.customers?.phone ?? bookingDetails?.phone ?? '';

      if (portalId && phone) {
        return { portalId, phone };
      }

      const parsedBookingId = Number.parseInt(String(bookingId), 10);
      if (!Number.isFinite(parsedBookingId)) {
        return { portalId: '', phone: '' };
      }

      const fetchViaRpc = async () => {
        const { data: payload, error } = await supabase.rpc('get_booking_for_post_checkout', {
          p_booking_id: parsedBookingId,
          p_payment_intent: paymentIntentId || null,
        });

        if (error || !payload?.customers) {
          return null;
        }

        return {
          portalId: payload.customers.customer_id_text ?? '',
          phone: payload.customers.phone ?? payload.booking?.phone ?? '',
        };
      };

      console.log(`[${timestamp}] [BookingConfirmation] Customer data missing, retrying via secure RPC...`);
      await new Promise(resolve => setTimeout(resolve, 500));

      let result = await fetchViaRpc();
      if (!result?.portalId || !result?.phone) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        result = await fetchViaRpc();
      }

      return result ?? { portalId: '', phone: '' };
    };

    try {
      const { portalId, phone } = await resolvePortalCredentials();

      console.log(`[${timestamp}] [BookingConfirmation] Portal access initiated`, {
        portalId,
        phone,
        hasCustomerData: !!bookingDetails?.customers,
        customerId: bookingDetails?.customer_id,
      });

      if (!portalId || !phone) {
        console.error(`[${timestamp}] [BookingConfirmation] Missing portal credentials after RPC retry`);
        toast({
          title: 'Portal Access Error',
          description: 'Missing portal credentials. Please contact support.',
          variant: 'destructive',
        });
        return;
      }

      const rawPhone = String(phone).replace(/\D/g, '');
      if (rawPhone.length !== 10) {
        toast({
          title: 'Portal Access Error',
          description: 'Invalid phone number on this booking. Please contact support.',
          variant: 'destructive',
        });
        return;
      }

      setIsPortalNavigating(true);

      console.log(`[${timestamp}] [BookingConfirmation] Clearing stale session and logging into portal...`);
      await supabase.auth.signOut({ scope: 'local' });

      const { data: loginData, error: loginError } = await supabase.functions.invoke('customer-portal-login', {
        body: {
          portal_number: portalId,
          phone: rawPhone,
        },
      });

      if (loginError) {
        throw new Error(loginError.message);
      }
      if (loginData?.error) {
        throw new Error(loginData.error);
      }
      if (!loginData?.session) {
        throw new Error('Could not create a portal session. Please try again.');
      }

      const { error: sessionError } = await supabase.auth.setSession(loginData.session);
      if (sessionError) {
        throw sessionError;
      }

      console.log(`[${timestamp}] [BookingConfirmation] Portal login successful, navigating...`);
      toast({
        title: 'Welcome to your portal',
        description: 'Loading your account...',
      });
      navigate('/customer-portal?tab=dashboard');
    } catch (err) {
      console.error(`[${timestamp}] [BookingConfirmation] Portal navigation error:`, err);

      toast({
        title: 'Portal Access Error',
        description: err.message || 'Your account is being set up. Please wait a moment and try again.',
        variant: 'destructive',
      });
    } finally {
      setIsPortalNavigating(false);
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

  const formatDate = (dateString) => formatBookingDateOnly(dateString, 'EEEE, MMMM d, yyyy');

  const serviceName = serviceDetails?.name || bookingDetails.plan?.name || 'N/A';
  const isDelivery = bookingDetails.addons?.deliveryService || bookingDetails.addons?.isDelivery;
  
  const isDumpLoaderRental = 
    serviceName.toLowerCase().includes('dump loader') ||
    serviceName.toLowerCase().includes('trailer') ||
    parseInt(bookingDetails.plan?.id) === 2;
  
  const showTimeWindow = shouldShowTimeWindow(bookingDetails.plan, isDelivery);
  const isSelfService = isSelfServiceTrailer(bookingDetails.plan, isDelivery);
  const timeOptions = {
    isWindow: showTimeWindow,
    isSelfService: isSelfService,
    serviceType: bookingDetails.plan?.service_type
  };

  const taxRateUsed = bookingDetails.tax_rate_used || 7.45;
  const taxAmount = bookingDetails.tax_amount || 0;
  const subtotalBeforeTax = bookingDetails.subtotal_before_tax || 0;
  const totalPaid = resolveBookingGrandTotal(bookingDetails);

  const bookingFinalized = finalizeStatus === 'done' || finalizeStatus === 'email_failed';

  const FinalizeBanner = () => (
    <div className={`p-5 rounded-xl mb-8 text-left flex items-start shadow-lg transition-all duration-500 ${
      finalizeStatus === 'done'
        ? 'bg-green-950/40 border border-green-500/40'
        : finalizeStatus === 'email_failed'
        ? 'bg-amber-950/40 border border-amber-500/40'
        : finalizeStatus === 'failed'
        ? 'bg-red-950/40 border border-red-500/40'
        : 'bg-blue-950/40 border border-blue-500/40'
    }`}>
      {finalizeStatus === 'pending' ? (
        <Loader2 className="h-6 w-6 mr-4 flex-shrink-0 mt-0.5 text-blue-400 animate-spin" />
      ) : (
        <Mail className={`h-6 w-6 mr-4 flex-shrink-0 mt-0.5 ${
          finalizeStatus === 'done' ? 'text-green-400'
          : finalizeStatus === 'email_failed' ? 'text-amber-400'
          : 'text-red-400'
        }`} />
      )}

      <div className="flex-1">
        <p className={`font-bold mb-1 ${
          finalizeStatus === 'done' ? 'text-green-300'
          : finalizeStatus === 'email_failed' ? 'text-amber-300'
          : finalizeStatus === 'failed' ? 'text-red-300'
          : 'text-blue-300'
        }`}>
          {finalizeStatus === 'done'
            ? '✓ Booking Confirmed & Email Sent'
            : finalizeStatus === 'email_failed'
            ? '✓ Booking Confirmed — Email Not Sent'
            : finalizeStatus === 'failed'
            ? '⚠ Confirmation Issue'
            : 'Sending confirmation email...'}
        </p>

        <p className={`text-sm mb-3 ${
          finalizeStatus === 'done' ? 'text-green-100/80'
          : finalizeStatus === 'email_failed' ? 'text-amber-100/80'
          : finalizeStatus === 'failed' ? 'text-red-100/80'
          : 'text-blue-100/80'
        }`}>
          {finalizeStatus === 'done'
            ? `A confirmation email has been sent to ${bookingDetails.email}. Your booking is secured.`
            : finalizeStatus === 'email_failed'
            ? `Your booking is secured, but we could not send the confirmation email${finalizeError ? `: ${finalizeError}` : ''}. You can retry below or use your receipt on this page.`
            : finalizeStatus === 'failed'
            ? `We encountered an issue finalizing your booking: ${finalizeError}. If payment succeeded, check your portal or contact support.`
            : 'Recording your payment and sending your confirmation email. This only takes a moment.'}
        </p>

        {(finalizeStatus === 'email_failed' || finalizeStatus === 'failed') && (
          <Button
            onClick={() => finalizeStatus === 'failed' ? finalizeBooking({ isRetry: true }) : resendConfirmationEmail()}
            disabled={isRefinalizing}
            size="sm"
            variant="outline"
            className={
              finalizeStatus === 'email_failed'
                ? 'bg-amber-950/50 text-amber-200 border-amber-500/30 hover:bg-amber-900 hover:text-white'
                : 'bg-red-950/50 text-red-200 border-red-500/30 hover:bg-red-900 hover:text-white'
            }
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

          {pointsAwarded > 0 && (
            <div className="bg-gradient-to-br from-purple-900/40 to-indigo-800/20 border border-purple-500/30 p-6 rounded-xl mb-8 text-left shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <Sparkles className="h-6 w-6 text-purple-300" />
                <h3 className="text-xl font-bold text-purple-300">Loyalty Points Earned!</h3>
              </div>
              <p className="text-purple-100/80 text-sm mb-3">
                You've earned <span className="font-bold text-purple-300">{pointsAwarded} loyalty points</span> with this booking! 
                Use your points on future orders for discounts.
              </p>
              <p className="text-xs text-purple-200/60">
                View your points balance and redeem rewards in your customer portal.
              </p>
            </div>
          )}

          {referralPendingAward > 0 && (
            <div className="bg-gradient-to-br from-amber-900/40 to-yellow-800/20 border border-amber-500/30 p-6 rounded-xl mb-8 text-left shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <Sparkles className="h-6 w-6 text-amber-300" />
                <h3 className="text-xl font-bold text-amber-300">You Helped Someone Earn a Reward</h3>
              </div>
              <p className="text-amber-100/80 text-sm">
                Because you were referred, you just helped a friend or family member earn a referral reward!
                Visit your Customer Portal anytime to track your balances, where you can also invite friends and family
                to try our services and start earning rewards yourself.
              </p>
            </div>
          )}

          {isDumpLoaderRental && (
            <div
              className="bg-gradient-to-br from-blue-900/40 to-indigo-800/20 border border-blue-500/30 p-4 rounded-xl mb-8 text-left shadow-lg"
              data-magic-link-ready={Boolean(magicLinkUrl)}
              data-magic-link-loading={generatingMagicLink}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-xl font-bold text-blue-400 flex items-center">
                  <Key className="mr-2 h-5 w-5" /> View Your Access Code
                </h3>
                <PickupLocationInfoButton />
              </div>
              <p className="text-blue-100/80 text-sm">
                To view your access code, see the customer portal below or refer to your receipt.
              </p>
            </div>
          )}

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

          {(bookingDetails.was_verification_skipped ||
            bookingDetails.status === 'pending_verification' ||
            bookingDetails.addons?.wasVerificationSkipped) && (
            <div className="bg-orange-900/40 border border-orange-500/50 p-5 rounded-xl mb-6 text-left shadow-lg">
              <h3 className="text-lg font-bold text-orange-300 mb-2 flex items-center">
                <AlertTriangle className="mr-2 h-5 w-5" />
                Action Required — Finish Your Booking
              </h3>
              <p className="text-orange-100/90 text-sm leading-relaxed">
                Your payment was received, but your booking is not complete until you add your towing vehicle license plate,
                driver’s license (front and back), and auto insurance information in the Customer Portal.
                Please complete verification as soon as possible — documents are required at least 12 hours before your pickup time.
                Log in below to open Identity Verification and submit your information.
              </p>
            </div>
          )}

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
              disabled={isPortalNavigating}
              className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-6 flex-1 text-lg border-none"
            >
              {isPortalNavigating ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Key className="mr-2 h-5 w-5" />
              )}
              Access Portal
            </Button>
            <Button
              onClick={handlePrint}
              disabled={!bookingFinalized}
              variant="outline"
              className="bg-white/5 border-blue-400/50 text-blue-100 hover:bg-blue-500 hover:text-white hover:border-blue-500 font-semibold py-6 flex-1 text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
};

export default BookingConfirmation;