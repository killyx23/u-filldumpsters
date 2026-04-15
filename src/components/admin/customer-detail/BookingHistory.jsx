import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { format, parseISO } from 'date-fns';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';
import { Button } from '@/components/ui/button';
import { Eye, Printer, Send, DollarSign, Loader2, Calendar, AlertTriangle, MapPin, Clock } from 'lucide-react';
import { SecureDeleteDialog } from '@/components/admin/SecureDeleteDialog';
import { calculateDistanceViaGoogleMaps, getBusinessAddress } from '@/utils/distanceCalculationHelper';

const DetailCard = ({ icon, title, children }) => (
    <div className="bg-white/5 p-6 rounded-lg shadow-lg">
        <div className="flex items-center mb-4">
            {icon}
            <h3 className="text-xl font-bold text-yellow-400 ml-3">{title}</h3>
        </div>
        {children}
    </div>
);

const DistanceWarning = ({ booking, customer }) => {
    const [distance, setDistance] = useState(booking.addons?.distanceInfo?.miles || customer?.distance_miles || null);
    const [travelTime, setTravelTime] = useState(booking.addons?.distanceInfo?.duration || customer?.travel_time_minutes || null);

    useEffect(() => {
        if (!distance && booking) {
            const address = booking.delivery_address?.formatted_address || `${booking.street}, ${booking.city}, ${booking.state} ${booking.zip}`;
            if(address && address.length > 10) {
                getBusinessAddress().then(origin => {
                    calculateDistanceViaGoogleMaps(origin, address).then(res => {
                        setDistance(res.distance);
                        setTravelTime(res.travelTime);
                    }).catch(e => console.error("Distance calculation error:", e));
                });
            }
        }
    }, [booking, distance]);

    if (!distance || distance <= 30) return null;

    return (
        <div className="mt-2 p-2 bg-red-900/40 border border-red-500/50 rounded-md text-sm flex flex-col gap-1 text-red-300">
            <span className="font-semibold flex items-center"><AlertTriangle className="mr-1 h-3 w-3" /> Extended Delivery Red Flag</span>
            <div className="flex gap-4 text-xs text-red-200">
                <span className="flex items-center"><MapPin className="mr-1 h-3 w-3" /> {Number(distance).toFixed(1)} mi</span>
                <span className="flex items-center"><Clock className="mr-1 h-3 w-3" /> {travelTime} mins</span>
            </div>
        </div>
    );
};

const BookingHistoryItem = ({ booking, customer, onReceiptSelect, onBookingDeleted }) => {
    const [isSending, setIsSending] = useState(false);
    const receiptRef = useRef();
    
    const paymentInfo = Array.isArray(booking.stripe_payment_info) ? booking.stripe_payment_info[0] : booking.stripe_payment_info;
    const stripeChargeId = paymentInfo?.stripe_charge_id || booking.payment_intent || booking.client_secret || 'N/A';

    const handlePrint = useReactToPrint({
        content: () => receiptRef.current,
        documentTitle: `U-Fill-Receipt-${booking?.id || 'booking'}`,
    });
    
    const handleResendConfirmation = async (booking) => {
        setIsSending(booking.id);
        const { error } = await supabase.functions.invoke('send-booking-confirmation', {
            body: { booking: { ...booking, customers: customer } },
        });

        if (error) {
            toast({ title: 'Failed to send email', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Confirmation Email Sent!', description: `An email has been sent to ${booking.email}.` });
        }
        setIsSending(null);
    };

    const getPendingReason = () => {
        if (booking.status !== 'pending_review' && booking.status !== 'pending_verification') return null;
        if (booking.reschedule_history && booking.reschedule_history.length > 0) {
            return 'Reschedule Request';
        }
        if (booking.was_verification_skipped) {
            return 'Initial Verification';
        }
        return 'Manual Review';
    };
    const pendingReason = getPendingReason();

    return (
        <div className="bg-white/10 p-4 rounded-md">
            <div className="hidden">
                 <PrintableReceipt ref={receiptRef} booking={{ ...booking, customers: customer }} />
            </div>
            <div className="flex justify-between items-start">
                <div>
                    <p className="font-bold text-lg text-white">{booking.plan?.name || 'N/A'}</p>
                    <p className="text-sm text-blue-200 flex items-center"><Calendar className="mr-2 h-4 w-4"/>Booked: {format(parseISO(booking.created_at), 'Pp')}</p>
                    <p className="text-sm text-blue-200">{format(parseISO(booking.drop_off_date), 'PPP')} - {format(parseISO(booking.pickup_date), 'PPP')}</p>
                    <p className="text-xs text-gray-400 mt-1">Stripe Charge ID: {stripeChargeId}</p>
                </div>
                <div className="text-right">
                    <StatusBadge status={booking.status} />
                    <p className="font-bold text-lg text-green-400 mt-1">${Number(booking.total_price || 0).toFixed(2)}</p>
                </div>
            </div>
            
            <DistanceWarning booking={booking} customer={customer} />

            {pendingReason && (
                <div className="mt-2 p-2 bg-orange-900/50 border border-orange-500/50 rounded-md text-sm text-orange-300 flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-2 flex-shrink-0" />
                    Pending Reason: <span className="font-semibold ml-1">{pendingReason}</span>
                </div>
            )}
            <div className="flex justify-end space-x-2 mt-3">
                <Button size="sm" variant="secondary" onClick={() => onReceiptSelect({ ...booking, customers: customer })}><Eye className="mr-2 h-4 w-4" /> View Details</Button>
                <Button size="sm" variant="outline" onClick={handlePrint}><Printer className="mr-2 h-4 w-4" /> Print</Button>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => handleResendConfirmation(booking)} disabled={isSending === booking.id}>
                    {isSending === booking.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4"/>} Resend
                </Button>
                <SecureDeleteDialog bookingId={booking.id} onDeleted={onBookingDeleted} />
            </div>
        </div>
    );
}

export const BookingHistory = ({ bookings, customer, onReceiptSelect, onBookingDeleted }) => {
    return (
        <DetailCard icon={<DollarSign className="h-6 w-6 text-yellow-400" />} title="Booking History">
            <div className="space-y-4">
                {bookings.length > 0 ? bookings.map(booking => (
                    <BookingHistoryItem key={booking.id} booking={booking} customer={customer} onReceiptSelect={onReceiptSelect} onBookingDeleted={onBookingDeleted} />
                )) : <p className="text-center text-blue-200 py-8">This customer has no booking history.</p>}
            </div>
        </DetailCard>
    );
};