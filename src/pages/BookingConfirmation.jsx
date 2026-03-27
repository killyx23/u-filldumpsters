import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, Home, AlertTriangle, Calendar, MapPin, Mail, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

export default function BookingConfirmation() {
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get('booking_id');
  
  const [loading, setLoading] = useState(true);
  const [bookingDetails, setBookingDetails] = useState(null);
  const [serviceDetails, setServiceDetails] = useState(null);
  const [emailStatus, setEmailStatus] = useState('unknown');
  const [resendingEmail, setResendingEmail] = useState(false);

  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BookingConfirmation] Component mounted. Booking ID from URL: ${bookingId}`);

    if (!bookingId) {
      console.error(`[${timestamp}] [BookingConfirmation] ERROR: No booking_id in URL`);
      setLoading(false);
      return;
    }

    const finalizeBooking = async () => {
      console.log(`[${timestamp}] [BookingConfirmation] Fetching booking details and finalizing...`);
      
      try {
        // First, fetch booking details
        const { data: booking, error: fetchError } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', bookingId)
          .single();

        if (fetchError || !booking) {
          console.error(`[${timestamp}] [BookingConfirmation] ERROR fetching booking:`, fetchError);
          toast({
            title: 'Error Loading Booking',
            description: 'Could not retrieve your booking details. Please contact support.',
            variant: 'destructive',
          });
          setLoading(false);
          return;
        }

        console.log(`[${timestamp}] [BookingConfirmation] Booking fetched. Status: ${booking.status}`);
        setBookingDetails(booking);

        // Fetch service details if service_id is available in plan
        if (booking.plan && booking.plan.service_id) {
          const { data: service, error: serviceError } = await supabase
            .from('services')
            .select('*')
            .eq('id', booking.plan.service_id)
            .single();

          if (!serviceError && service) {
            console.log(`[${timestamp}] [BookingConfirmation] Service details fetched:`, service.name);
            setServiceDetails(service);
          }
        }

        // If booking is not yet confirmed, call finalize-booking
        if (booking.status !== 'confirmed') {
          console.log(`[${timestamp}] [BookingConfirmation] Booking not confirmed. Calling finalize-booking...`);
          
          const { data: finalizeResult, error: finalizeError } = await supabase.functions.invoke(
            'finalize-booking',
            { body: { booking_id: bookingId } }
          );

          if (finalizeError) {
            console.error(`[${timestamp}] [BookingConfirmation] ERROR calling finalize-booking:`, finalizeError);
            setEmailStatus('failed');
            toast({
              title: 'Booking Finalization Error',
              description: 'Your payment was successful, but we encountered an issue finalizing your booking. Our team has been notified.',
              variant: 'destructive',
            });
          } else if (finalizeResult) {
            console.log(`[${timestamp}] [BookingConfirmation] Finalize result:`, finalizeResult);
            setEmailStatus(finalizeResult.email_status || 'unknown');
            
            // Refresh booking details to get updated status
            const { data: updatedBooking } = await supabase
              .from('bookings')
              .select('*')
              .eq('id', bookingId)
              .single();
            
            if (updatedBooking) {
              setBookingDetails(updatedBooking);
            }
          }
        } else {
          console.log(`[${timestamp}] [BookingConfirmation] Booking already confirmed`);
          setEmailStatus('sent');
        }
      } catch (error) {
        console.error(`[${timestamp}] [BookingConfirmation] EXCEPTION:`, error);
        toast({
          title: 'Unexpected Error',
          description: error.message,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    finalizeBooking();
  }, [bookingId]);

  const handleResendEmail = async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BookingConfirmation] Resend email button clicked`);
    
    setResendingEmail(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('resend-confirmation-email', {
        body: { booking_id: bookingId }
      });

      if (error) {
        console.error(`[${timestamp}] [BookingConfirmation] ERROR resending email:`, error);
        toast({
          title: 'Email Resend Failed',
          description: 'Could not resend confirmation email. Please contact support.',
          variant: 'destructive',
        });
      } else if (data?.success) {
        console.log(`[${timestamp}] [BookingConfirmation] Email resent successfully`);
        setEmailStatus('sent');
        toast({
          title: 'Email Resent',
          description: `Confirmation email has been resent to ${bookingDetails?.email}`,
        });
      }
    } catch (error) {
      console.error(`[${timestamp}] [BookingConfirmation] EXCEPTION resending email:`, error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setResendingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-16 w-16 animate-spin text-blue-400 mb-4" />
        <p className="text-white text-xl">Processing your booking confirmation...</p>
      </div>
    );
  }

  if (!bookingId || !bookingDetails) {
    return (
      <div className="container mx-auto px-4 py-16 flex flex-col items-center">
        <div className="bg-white/10 backdrop-blur-md p-8 rounded-2xl border border-white/20 shadow-2xl max-w-2xl w-full text-center">
          <AlertTriangle className="h-16 w-16 text-amber-400 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-white mb-4">Booking Not Found</h1>
          <p className="text-gray-300 mb-8">
            We couldn't locate your booking. This may happen if the URL is incomplete or incorrect.
          </p>
          <Button asChild size="lg" className="bg-blue-600 hover:bg-blue-700 text-white">
            <Link to="/">
              <Home className="mr-2 h-5 w-5" />
              Return to Homepage
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const deliveryAddress = bookingDetails.delivery_address || bookingDetails.contact_address || {};
  const formattedAddress = `${deliveryAddress.street || bookingDetails.street}, ${deliveryAddress.city || bookingDetails.city}, ${deliveryAddress.state || bookingDetails.state} ${deliveryAddress.zip || bookingDetails.zip}`;
  
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const formatTime = (timeString) => {
    if (!timeString) return 'N/A';
    try {
      const [hours, minutes] = timeString.split(':');
      const date = new Date();
      date.setHours(parseInt(hours, 10));
      date.setMinutes(parseInt(minutes || '0', 10));
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return timeString;
    }
  };

  const getServiceSpecificSteps = () => {
    const serviceType = serviceDetails?.service_type;
    const serviceName = serviceDetails?.name || bookingDetails.plan?.name || '';

    // Check if it's a Dump Loader Trailer Rental
    if (serviceType === 'trailer_rental' || serviceName.toLowerCase().includes('dump loader') || serviceName.toLowerCase().includes('trailer')) {
      return [
        `Pick up the trailer at our location on ${formatDate(bookingDetails.drop_off_date)} at ${formatTime(bookingDetails.drop_off_time_slot)}.`,
        'Ensure your towing vehicle meets the minimum requirements (usually a 1/2-ton truck or larger with a 2" ball hitch).',
        'Fill the trailer at your convenience during the rental period.',
        `Return the trailer by ${formatDate(bookingDetails.pickup_date)} at ${formatTime(bookingDetails.pickup_time_slot)}.`,
        'Make sure the trailer is empty and clean before returning.',
      ];
    }

    // Default steps for dumpster delivery
    return [
      `We'll arrive at your location on ${formatDate(bookingDetails.drop_off_date)} at ${formatTime(bookingDetails.drop_off_time_slot)}.`,
      'Our team will place the dumpster in your designated area.',
      'Fill the dumpster at your convenience during the rental period.',
      `We'll pick up the dumpster on ${formatDate(bookingDetails.pickup_date)} by ${formatTime(bookingDetails.pickup_time_slot)}.`,
    ];
  };

  return (
    <div className="container mx-auto px-4 py-16 flex flex-col items-center">
      <div className="bg-white/10 backdrop-blur-md p-8 rounded-2xl border border-white/20 shadow-2xl max-w-2xl w-full text-center">
        
        <div className="flex justify-center mb-6">
          <div className="h-24 w-24 bg-green-500/20 rounded-full flex items-center justify-center border-4 border-green-400">
            <CheckCircle className="w-12 h-12 text-green-400" />
          </div>
        </div>
        
        <h1 className="text-4xl font-bold text-white mb-4">Booking Confirmed!</h1>
        
        <p className="text-xl text-blue-200 mb-8">
          Thank you for choosing U-Fill Dumpsters. Your order has been placed successfully.
        </p>

        {/* Service Information */}
        {serviceDetails && (
          <div className="bg-blue-900/40 border border-blue-500/50 p-6 rounded-xl mb-8 text-left">
            <h3 className="text-2xl font-bold text-blue-200 mb-3">{serviceDetails.name}</h3>
            {serviceDetails.description && (
              <p className="text-blue-100 leading-relaxed">{serviceDetails.description}</p>
            )}
          </div>
        )}
        
        <div className="bg-black/30 p-6 rounded-xl mb-8 text-left space-y-4">
          <p className="text-white">
            <span className="text-blue-300 font-semibold w-32 inline-block">Booking ID:</span> 
            <span className="text-2xl font-bold text-green-400">#{bookingDetails.id}</span>
          </p>
          <p className="text-white">
            <span className="text-blue-300 font-semibold w-32 inline-block">Customer:</span> 
            {bookingDetails.name || `${bookingDetails.first_name} ${bookingDetails.last_name}`}
          </p>
          <p className="text-white">
            <span className="text-blue-300 font-semibold w-32 inline-block">Email:</span> 
            {bookingDetails.email}
          </p>
          <p className="text-white">
            <span className="text-blue-300 font-semibold w-32 inline-block">Service:</span> 
            {serviceDetails?.name || bookingDetails.plan?.name || 'N/A'}
          </p>
          <p className="text-white flex items-start">
            <Calendar className="h-5 w-5 text-blue-300 mr-2 mt-1 flex-shrink-0"/>
            <span>
              <strong>Drop-off/Pickup:</strong> {formatDate(bookingDetails.drop_off_date)} at {formatTime(bookingDetails.drop_off_time_slot)}
              <br/>
              <strong>Return:</strong> {formatDate(bookingDetails.pickup_date)} by {formatTime(bookingDetails.pickup_time_slot)}
            </span>
          </p>
          <p className="text-white flex items-start">
            <MapPin className="h-5 w-5 text-blue-300 mr-2 mt-1 flex-shrink-0"/>
            <span className="break-words">{formattedAddress}</span>
          </p>
        </div>

        {/* Email Status */}
        <div className={`p-5 rounded-lg mb-8 text-left flex items-start shadow-lg ${
          emailStatus === 'sent' 
            ? 'bg-green-900/40 border border-green-500/50' 
            : emailStatus === 'failed'
            ? 'bg-red-900/40 border border-red-500/50'
            : 'bg-blue-900/40 border border-blue-500/50'
        }`}>
          <Mail className={`h-6 w-6 mr-3 flex-shrink-0 mt-0.5 ${
            emailStatus === 'sent' ? 'text-green-400' : emailStatus === 'failed' ? 'text-red-400' : 'text-blue-400'
          }`} />
          <div className="flex-1">
            {emailStatus === 'sent' ? (
              <>
                <p className="font-bold text-green-300 mb-1">✓ Confirmation Email Sent</p>
                <p className="text-sm text-green-100">
                  A detailed confirmation email has been sent to <strong>{bookingDetails.email}</strong>. 
                  Please check your inbox and spam folder.
                </p>
              </>
            ) : emailStatus === 'failed' ? (
              <>
                <p className="font-bold text-red-300 mb-1">⚠ Email Delivery Issue</p>
                <p className="text-sm text-red-100 mb-3">
                  We encountered an issue sending your confirmation email. Your booking is still confirmed, 
                  but you may not have received the email.
                </p>
                <Button
                  onClick={handleResendEmail}
                  disabled={resendingEmail}
                  size="sm"
                  variant="outline"
                  className="border-red-400 text-red-300 hover:bg-red-500 hover:text-white"
                >
                  {resendingEmail ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Resending...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Resend Confirmation Email
                    </>
                  )}
                </Button>
              </>
            ) : (
              <>
                <p className="font-bold text-blue-300 mb-1">Email Status Unknown</p>
                <p className="text-sm text-blue-100 mb-3">
                  We're not sure if the confirmation email was sent successfully. 
                  You can try resending it below.
                </p>
                <Button
                  onClick={handleResendEmail}
                  disabled={resendingEmail}
                  size="sm"
                  variant="outline"
                  className="border-blue-400 text-blue-300 hover:bg-blue-500 hover:text-white"
                >
                  {resendingEmail ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Send Confirmation Email
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>

        {bookingDetails.was_verification_skipped && (
          <div className="bg-amber-900/40 border border-amber-500/50 p-5 rounded-lg mb-8 text-amber-100 flex items-start text-left shadow-lg">
            <AlertTriangle className="h-6 w-6 mr-3 flex-shrink-0 text-amber-400 mt-0.5" />
            <div>
              <p className="font-bold text-amber-300 mb-1">Manual Review Required</p>
              <p className="text-sm">
                Your delivery address could not be automatically verified. Our team will review 
                the address details manually prior to delivery. We will contact you if any 
                clarification is needed.
              </p>
            </div>
          </div>
        )}
        
        <div className="bg-black/30 p-6 rounded-xl mb-8 text-left">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center">
            <CheckCircle className="h-6 w-6 text-green-400 mr-2" />
            What's Next?
          </h3>
          <ol className="space-y-3 text-gray-200">
            {getServiceSpecificSteps().map((step, index) => (
              <li key={index} className="flex items-start">
                <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 font-bold text-sm">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
        
        <p className="text-gray-300 mb-8 leading-relaxed">
          If you have any questions or need to make changes, please don't hesitate to contact our support team 
          at <a href="mailto:support@u-filldumpsters.com" className="text-blue-400 hover:underline">support@u-filldumpsters.com</a>.
        </p>
        
        <Button asChild size="lg" className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto font-semibold py-6">
          <Link to="/">
            <Home className="mr-2 h-5 w-5" /> 
            Return to Homepage
          </Link>
        </Button>
        
      </div>
    </div>
  );
}