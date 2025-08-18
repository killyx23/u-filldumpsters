import React, { useState, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { format, parseISO } from 'date-fns';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';
import { Button } from '@/components/ui/button';
import { Eye, Printer, Send, DollarSign, Loader2 } from 'lucide-react';

const DetailCard = ({ icon, title, children }) => (
    <div className="bg-white/5 p-6 rounded-lg shadow-lg">
        <div className="flex items-center mb-4">
            {icon}
            <h3 className="text-xl font-bold text-yellow-400 ml-3">{title}</h3>
        </div>
        {children}
    </div>
);

const BookingHistoryItem = ({ booking, customer, onReceiptSelect }) => {
    const [isSending, setIsSending] = useState(false);
    const receiptRef = useRef();

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

    return (
        <div className="bg-white/10 p-4 rounded-md">
            <div className="hidden">
                 <PrintableReceipt ref={receiptRef} booking={{ ...booking, customers: customer }} />
            </div>
            <div className="flex justify-between items-start">
                <div>
                    <p className="font-bold text-lg text-white">{booking.plan.name}</p>
                    <p className="text-sm text-blue-200">{format(parseISO(booking.drop_off_date), 'PPP')} - {format(parseISO(booking.pickup_date), 'PPP')}</p>
                    <p className="text-xs text-gray-400 mt-1">Stripe ID: {booking.stripe_payment_intent_id || 'N/A'}</p>
                </div>
                <div className="text-right">
                    <StatusBadge status={booking.status} />
                    <p className="font-bold text-lg text-green-400 mt-1">${booking.total_price.toFixed(2)}</p>
                </div>
            </div>
            <div className="flex justify-end space-x-2 mt-3">
                <Button size="sm" variant="secondary" onClick={() => onReceiptSelect({ ...booking, customers: customer })}><Eye className="mr-2 h-4 w-4" /> View Details</Button>
                <Button size="sm" variant="outline" onClick={handlePrint}><Printer className="mr-2 h-4 w-4" /> Print</Button>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => handleResendConfirmation(booking)} disabled={isSending === booking.id}>
                    {isSending === booking.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4"/>} Resend
                </Button>
            </div>
        </div>
    );
}

export const BookingHistory = ({ bookings, customer, onReceiptSelect }) => {
    return (
        <DetailCard icon={<DollarSign className="h-6 w-6 text-yellow-400" />} title="Booking History & Receipts">
            <div className="space-y-4">
                {bookings.length > 0 ? bookings.map(booking => (
                    <BookingHistoryItem key={booking.id} booking={booking} customer={customer} onReceiptSelect={onReceiptSelect}/>
                )) : <p className="text-center text-blue-200 py-8">This customer has no booking history.</p>}
            </div>
        </DetailCard>
    );
};