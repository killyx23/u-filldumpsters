import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, Clock } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { RescheduleDialog as ModularRescheduleDialog } from './reschedule/RescheduleDialog';
import { expireActiveRentalAccessCodesForOrder } from '@/utils/bookingPinReinstate';
import { getBookingDateTime } from '@/utils/bookingPickupWindow';
import { differenceInHours } from 'date-fns';
import { mapFeeRowsToConfig, DEFAULT_FEES } from '@/utils/chargesAndFeesConfig';

// Re-export the modular RescheduleDialog so the rest of the app uses the new one
export const RescheduleDialog = ModularRescheduleDialog;

export const CancelDialog = ({ booking, isOpen, onOpenChange, onUpdate }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [feeInfo, setFeeInfo] = useState(null);
    const [loadingFees, setLoadingFees] = useState(true);

    useEffect(() => {
        if (!isOpen || !booking) return;
        let cancelled = false;

        const loadFees = async () => {
            setLoadingFees(true);
            try {
                const { data } = await supabase
                    .from('charges_and_fees')
                    .select('fee_key, fee_value');
                if (cancelled) return;

                const fees = { ...DEFAULT_FEES, ...mapFeeRowsToConfig(data) };
                const appointmentDate = getBookingDateTime(booking.drop_off_date, booking.drop_off_time_slot);
                const hoursUntil = appointmentDate
                    ? differenceInHours(appointmentDate, new Date())
                    : null;
                const isLate = hoursUntil !== null && hoursUntil <= 24;
                const pct = isLate ? fees.late_cancel_percentage : fees.advance_cancel_percentage;
                const total = booking.total_price || 0;
                const maxFee = parseFloat(((pct / 100) * total).toFixed(2));

                setFeeInfo({
                    fee_type: isLate ? 'late' : 'advance',
                    fee_percentage: pct,
                    max_fee_amount: maxFee,
                    hours_before_appointment: hoursUntil,
                    total_price: total,
                });
            } catch {
                if (!cancelled) {
                    setFeeInfo({
                        fee_type: 'advance',
                        fee_percentage: DEFAULT_FEES.advance_cancel_percentage,
                        max_fee_amount: parseFloat(((DEFAULT_FEES.advance_cancel_percentage / 100) * (booking.total_price || 0)).toFixed(2)),
                        hours_before_appointment: null,
                        total_price: booking.total_price || 0,
                    });
                }
            } finally {
                if (!cancelled) setLoadingFees(false);
            }
        };
        loadFees();
        return () => { cancelled = true; };
    }, [isOpen, booking?.id, booking?.drop_off_date, booking?.drop_off_time_slot, booking?.total_price]);

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const { error } = await supabase.from('reschedule_history_logs').insert({
                booking_id: booking.id,
                request_type: 'cancellation',
                request_status: 'pending',
                cancellation_reason: 'Customer requested cancellation via portal.',
                reschedule_request_time: new Date().toISOString(),
                previous_status: booking.status,
                fee_type: feeInfo?.fee_type || 'advance',
                fee_percentage: feeInfo?.fee_percentage ?? 0,
                fee_amount: feeInfo?.max_fee_amount ?? 0,
                hours_before_appointment: feeInfo?.hours_before_appointment ?? null,
            });

            if (error) throw error;

            const hoursLabel =
                feeInfo?.hours_before_appointment != null
                    ? `${feeInfo.hours_before_appointment} hours before appointment`
                    : 'hours before appointment unavailable';
            await supabase.from('customer_notes').insert({
                customer_id: booking.customer_id,
                booking_id: booking.id,
                source: 'Cancellation Request',
                content: `Customer requested cancellation via portal. Cancelled ${hoursLabel}. Fee type: ${feeInfo?.fee_type === 'late' ? 'Late cancellation' : 'Advance cancellation'} (${feeInfo?.fee_percentage ?? 0}%). Max fee: $${(feeInfo?.max_fee_amount ?? 0).toFixed(2)}.`,
                author_type: 'customer',
            });

            await supabase.from('bookings').update({ status: 'cancellation_pending' }).eq('id', booking.id);
            expireActiveRentalAccessCodesForOrder(booking.id, 'customer');

            await supabase.from('chat_messages').insert({
                conversation_id: `cust_${booking.customer_id}`,
                customer_id: booking.customer_id,
                booking_id: booking.id,
                sender_type: 'customer',
                message_content: `I would like to request a cancellation for Booking #${booking.id}. This request is now pending and waiting for scheduling approval.`,
                is_read: false,
            });

            toast({ title: 'Cancellation Request Submitted', description: 'Your request has been sent for review.' });
            if (onUpdate) onUpdate();
            onOpenChange(false);
        } catch (e) {
            toast({ title: 'Cancellation Failed', description: e.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const isLate = feeInfo?.fee_type === 'late';

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-red-500/50 text-white max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-red-400 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" /> Confirm Cancellation
                    </DialogTitle>
                    <DialogDescription className="text-gray-400">
                        Are you sure you want to request to cancel booking #{booking?.id}?
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 text-sm space-y-4">
                    {loadingFees ? (
                        <div className="flex items-center gap-2 text-gray-400">
                            <Loader2 className="h-4 w-4 animate-spin" /> Calculating cancellation fees...
                        </div>
                    ) : feeInfo ? (
                        <div className={`rounded-lg border p-4 space-y-2 ${isLate ? 'bg-red-900/30 border-red-500/50' : 'bg-amber-900/30 border-amber-500/50'}`}>
                            <div className="flex items-center gap-2">
                                <Clock className="h-4 w-4 shrink-0" />
                                <p className={`font-semibold ${isLate ? 'text-red-300' : 'text-amber-300'}`}>
                                    {isLate ? 'Late Cancellation (within 24 hours)' : 'Advance Cancellation (more than 24 hours)'}
                                </p>
                            </div>
                            <p className="text-gray-300">
                                A cancellation fee of up to <span className="font-bold text-white">{feeInfo.fee_percentage}%</span> of
                                your booking total (<span className="font-bold text-white">${feeInfo.total_price.toFixed(2)}</span>)
                                may be charged.
                            </p>
                            <p className={`text-lg font-bold ${isLate ? 'text-red-300' : 'text-amber-300'}`}>
                                Maximum fee: ${feeInfo.max_fee_amount.toFixed(2)}
                            </p>
                        </div>
                    ) : null}

                    <p className="text-gray-300">
                        A request will be sent to our team to cancel this booking. Our team will review
                        the request and process any applicable refunds.
                    </p>
                </div>

                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="border-gray-600 text-gray-300 hover:bg-gray-800 hover:text-white">
                        Go Back
                    </Button>
                    <Button variant="destructive" onClick={handleSubmit} disabled={isSubmitting || loadingFees} className="bg-red-600 hover:bg-red-700">
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Yes, Request Cancellation
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};