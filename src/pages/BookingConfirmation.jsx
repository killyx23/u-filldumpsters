import React, { useState, useEffect, useRef, useCallback } from 'react';
    import { Link, useSearchParams, useNavigate } from 'react-router-dom';
    import { motion } from 'framer-motion';
    import { CheckCircle, Home, Calendar, Mail, DollarSign, User, Phone, MapPin, Clock, Loader2, AlertTriangle, XCircle, Printer, Truck, Key, Tag } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { format, parseISO, isValid, addHours } from 'date-fns';
    import { supabase } from '@/lib/customSupabaseClient';
    import { toast } from '@/components/ui/use-toast';
    import { useReactToPrint } from 'react-to-print';
    import { PrintableReceipt } from '@/components/PrintableReceipt';
    
    const ConfirmationLine = ({ label, value, icon, isFee = false, isPending = false, isDiscount = false }) => (
      <div className="flex items-start py-3">
        <div className={`${isFee || isPending ? 'text-red-400' : isDiscount ? 'text-green-400' : 'text-yellow-400'} mr-4 flex-shrink-0`}>{icon}</div>
        <div>
          <p className="font-semibold text-blue-100">{label}</p>
          <p className={`break-words ${isPending ? 'text-red-400 font-bold' : isDiscount ? 'text-green-400 font-bold' : 'text-white'}`}>{value}</p>
        </div>
      </div>
    );
    
    function BookingConfirmation() {
      const [searchParams] = useSearchParams();
      const navigate = useNavigate();
      const sessionId = searchParams.get('session_id');
      const [booking, setBooking] = useState(null);
      const [status, setStatus] = useState('loading');
      const receiptRef = useRef();
    
      const handlePrint = useReactToPrint({
        content: () => receiptRef.current,
        documentTitle: `U-Fill-Receipt-${booking?.id || 'booking'}`,
      });
    
      const fetchBookingDetails = useCallback(async (sessionId, attempt = 1) => {
        if (!sessionId) {
          setStatus('error');
          toast({ title: "Missing Payment Session", description: "Cannot find booking confirmation details.", variant: "destructive" });
          navigate('/');
          return;
        }
    
        try {
          const { data: sessionStatus, error: sessionStatusError } = await supabase.functions.invoke('get-session-status', { body: { sessionId } });
          
          if (sessionStatusError || sessionStatus?.payment_status !== 'paid') {
              if (attempt < 8) {
                  setTimeout(() => fetchBookingDetails(sessionId, attempt + 1), 2000 * attempt);
                  return;
              } else {
                  throw new Error("Payment could not be confirmed with Stripe. Please contact support.");
              }
          }
    
          const { data: bookingData, error: bookingError } = await supabase.functions.invoke('get-booking-by-session', {
            body: { sessionId }
          });
          
          if (bookingError || (bookingData && bookingData.error)) {
            const errorMessage = (bookingData && bookingData.error) || bookingError?.message || "Unknown error";
            if (errorMessage.includes('Payment info not found') && attempt < 12) {
              setTimeout(() => fetchBookingDetails(sessionId, attempt + 1), 2000 * attempt);
            } else {
              throw new Error(errorMessage);
            }
          } else if (bookingData.booking) {
            setBooking(bookingData.booking);
            setStatus('success');
            // Trigger email sending
            supabase.functions.invoke('send-booking-confirmation', { body: { bookingId: bookingData.booking.id } })
              .catch(err => console.error("Failed to send confirmation email on page load:", err));

          } else {
             if (attempt < 15) {
                setTimeout(() => fetchBookingDetails(sessionId, attempt + 1), 2500 * attempt);
             } else {
                throw new Error("Booking data is not yet available. Please check your email for confirmation.");
             }
          }
        } catch (err) {
          console.error("Error fetching booking details:", err);
          setStatus('error');
          toast({
            title: "Could Not Load Confirmation",
            description: err.message || "There was a problem loading your booking details. Please check your email or contact support.",
            variant: "destructive",
            duration: 30000
          });
        }
      }, [navigate]);
    
      useEffect(() => {
        const timer = setTimeout(() => {
          fetchBookingDetails(sessionId);
        }, 2000);
        
        return () => clearTimeout(timer);
      }, [sessionId, fetchBookingDetails]);
    
      const renderContent = () => {
        switch (status) {
          case 'loading':
            return (
              <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)]">
                <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
                <p className="text-white text-2xl mt-4">Finalizing your booking...</p>
                <p className="text-blue-200 mt-2">This may take a moment. Please don't refresh the page.</p>
              </div>
            );
          case 'error':
            return (
               <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] text-center">
                <XCircle className="h-16 w-16 text-red-500" />
                <h1 className="text-white text-3xl mt-4 font-bold">There was an issue with your confirmation</h1>
                <p className="text-blue-200 mt-2 max-w-md">Your payment was likely successful, but we had trouble displaying the details. Please check your email for a receipt or contact support if it doesn't arrive shortly.</p>
                 <Link to="/">
                  <Button className="mt-8">
                    <Home className="mr-2" /> Back to Homepage
                  </Button>
                </Link>
              </div>
            );
          case 'success':
            if (!booking || !booking.customers) {
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
    
            const { plan: originalPlan, drop_off_date, pickup_date, total_price, drop_off_time_slot, pickup_time_slot, addons, status: bookingStatus, customers } = booking;
            const plan = addons?.plan || originalPlan;
            const { name, email, phone, street, city, state, zip, customer_id_text } = customers;
            const fullAddress = `${street}, ${city}, ${state} ${zip}`;
            const distanceInfo = addons?.distanceInfo;
            const isDelivery = addons?.deliveryService;
            const isSelfServiceTrailer = plan.id === 2 && !isDelivery;
            const isWindowService = plan.id === 1 || isDelivery || plan.id === 3;
            const isPendingVerification = bookingStatus === 'pending_verification' || bookingStatus === 'pending_review';
            const coupon = addons?.coupon;
            const customerPortalLink = `/login?cid=${encodeURIComponent(customer_id_text)}&phone=${encodeURIComponent(phone)}`;


             const formatTime = (timeString, isWindow = false, isSelfService = false) => {
                if (!timeString || !/^\d{2}:\d{2}/.test(timeString)) return 'N/A';
                try {
                    const date = parseISO(`1970-01-01T${timeString}`);
                    if (!isValid(date)) return 'N/A';

                    if (isSelfService) {
                        if (timeString.startsWith('08:00')) return `after ${format(date, 'h:mm a')}`;
                        if (timeString.startsWith('22:00')) return `by ${format(date, 'h:mm a')}`;
                    }

                    if (isWindow) {
                        const endTime = addHours(date, 2);
                        return `between ${format(date, 'h:mm a')} - ${format(endTime, 'h:mm a')}`;
                    }
                    return format(date, 'h:mm a');
                } catch (e) {
                    return 'N/A';
                }
            };

            const getDiscountAmount = () => {
                if (coupon && coupon.isValid) {
                    if (coupon.discountType === 'fixed') {
                        return coupon.discountValue;
                    } else if (coupon.discountType === 'percentage') {
                        const subtotal = (total_price || 0) / (1 - (coupon.discountValue / 100));
                        return subtotal * (coupon.discountValue / 100);
                    }
                }
                return 0;
            };
            const discountAmount = getDiscountAmount();
            
            const totalFee = distanceInfo?.totalFee ?? 0;
    
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
                       {isPendingVerification ? (
                           <AlertTriangle className="h-24 w-24 text-orange-400 mx-auto mb-6" />
                       ) : (
                          <CheckCircle className="h-24 w-24 text-green-400 mx-auto mb-6" />
                       )}
                    </motion.div>
                    <h1 className="text-4xl font-bold text-white mb-4">
                      {isPendingVerification ? 'Booking on Hold' : 'Booking Confirmed!'}
                    </h1>
                    <p className="text-lg text-blue-200 mb-8">
                      {isPendingVerification ? 
                       `Thank you for your rental. Your order is pending manual review. Please refer to your Customer Portal for more information and updates.` :
                       `Thank you, ${name}! Your rental is scheduled. A confirmation email with all details has been sent to ${email}.`
                      }
                    </p>
          
                    <div className="bg-yellow-900/30 border border-yellow-500/50 p-6 rounded-lg mb-8 text-left">
                      <h3 className="flex items-center text-xl font-bold text-yellow-300 mb-3"><Key className="mr-3 h-6 w-6"/>Your Customer Portal Login</h3>
                      <p className="text-yellow-200">Use the following credentials to access your <Link to={customerPortalLink} className="font-bold underline hover:text-white">Customer Portal</Link> to view your booking status, add notes, or upload files.</p>
                      <p className="text-white mt-2"><strong>Your Customer ID:</strong> <span className="font-mono bg-black/30 p-1 rounded">{customer_id_text}</span></p>
                      <p className="text-white"><strong>Your Phone Number:</strong> <span className="font-mono bg-black/30 p-1 rounded">{phone}</span></p>
                    </div>
                    
                    {plan.id === 2 && !isDelivery && !isPendingVerification && (
                      <div className="bg-blue-900/30 border border-blue-500/50 p-6 rounded-lg mb-8 text-left">
                        <h3 className="flex items-center text-xl font-bold text-yellow-300 mb-3"><Truck className="mr-3 h-6 w-6"/>Important Pickup Information</h3>
                        <p className="text-blue-200"><strong>Pickup Location:</strong> 227 W. Casi Way, Saratoga Springs, UT 84045.</p>
                        <p className="text-blue-200 mt-1"><strong>Pickup Time:</strong> Your trailer is available from <strong>8:00 a.m.</strong> on your pickup date.</p>
                        <p className="text-blue-200 mt-1"><strong>Return Time:</strong> Please return the trailer by <strong>10:00 p.m.</strong> on your return date. Remember to clean it out to avoid fines.</p>
                      </div>
                    )}
          
                    <div className="bg-white/5 p-6 rounded-lg mb-8 text-left divide-y divide-white/10">
                      <ConfirmationLine icon={<User className="h-6 w-6" />} label="Name" value={name} />
                       <ConfirmationLine icon={<Mail className="h-6 w-6" />} label="Email" value={email} />
                      <ConfirmationLine icon={<Phone className="h-6 w-6" />} label="Phone" value={phone} />
                       {(plan.id === 1 || isDelivery) && <ConfirmationLine icon={<MapPin className="h-6 w-6" />} label="Delivery Address" value={fullAddress} />}
                      <ConfirmationLine icon={<Calendar className="h-6 w-6" />} label="Service" value={plan.name} />
                      <ConfirmationLine icon={<Clock className="h-6 w-6" />} label={plan.id === 2 ? (isDelivery ? "Delivery" : "Pickup") : "Drop-off"} value={isPendingVerification ? 'Pending Review' : `${format(parseISO(drop_off_date), 'PPP')} - ${formatTime(drop_off_time_slot, isWindowService, isSelfServiceTrailer)}`} isPending={isPendingVerification} />
                       {plan.id !== 3 && <ConfirmationLine icon={<Clock className="h-6 w-6" />} label={plan.id === 2 ? "Return" : "Pickup"} value={isPendingVerification ? 'Pending Review' : `${format(parseISO(pickup_date), 'PPP')} - ${formatTime(pickup_time_slot, isWindowService, isSelfServiceTrailer)}`} isPending={isPendingVerification} />}
                       {isDelivery && distanceInfo && totalFee > 0 && <ConfirmationLine icon={<Truck className="h-6 w-6"/>} label="Trailer Delivery Fee" value={`$${totalFee.toFixed(2)} (${(distanceInfo.roundTripMiles || 0).toFixed(1)} miles)`} isFee={true} />}
                       {addons?.fee > 0 && !isDelivery && <ConfirmationLine icon={<Truck className="h-6 w-6"/>} label="Extended Delivery Fee" value={`$${(addons.fee || 0).toFixed(2)}`} isFee={true} />}
                       {discountAmount > 0 && <ConfirmationLine icon={<Tag className="h-6 w-6"/>} label={`Coupon Discount (${coupon.code})`} value={`- ${discountAmount.toFixed(2)}`} isDiscount={true} />}
                      <div className="flex items-center py-3">
                        <div className="text-yellow-400 mr-4 flex-shrink-0"><DollarSign className="h-6 w-6" /></div>
                        <div>
                          <p className="font-semibold text-blue-100">Total Amount Paid</p>
                          <div className="flex items-baseline">
                            <p className="break-words text-white">${(total_price || 0).toFixed(2)}</p>
                            <span className="text-sm text-blue-200 ml-2">(plus taxes)</span>
                          </div>
                        </div>
                      </div>
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
          default:
            return null;
        }
      };
    
      return renderContent();
    }
    
    export default BookingConfirmation;