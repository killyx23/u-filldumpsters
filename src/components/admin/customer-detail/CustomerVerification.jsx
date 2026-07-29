
import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Car, ShieldAlert, FileText, Check, X, DollarSign, Loader2, Edit, Save, MessageSquare, CheckCircle, History, AlertTriangle, CreditCard, MapPin, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useReactToPrint } from 'react-to-print';
import { PrintableReceipt } from '@/components/PrintableReceipt';
import { updateVerificationStatus } from '@/utils/verificationImageHelper';
import { VerificationImageDisplay } from '@/components/VerificationImageDisplay';
import { useVerificationImageHistory } from '@/hooks/useVerificationImageHistory';
import { format, parseISO, isValid } from 'date-fns';
import { reinstatePinTrackingPatch, expireActiveRentalAccessCodesForOrder } from '@/utils/bookingPinReinstate';
import {
    getPendingAddressChange,
    markAddressChangesApproved,
    normalizeAddress,
    formatAddressDisplay,
} from '@/utils/addressHelpers';

const DEFAULT_CANCELLATION_DESCRIPTION =
    'Your cancellation has been approved; you should expect a refund minus any cancellation fees.';

const fetchPendingCancellationLog = async (bookingId) => {
    if (!bookingId) return null;
    const { data, error } = await supabase
        .from('reschedule_history_logs')
        .select('*')
        .eq('booking_id', bookingId)
        .eq('request_type', 'cancellation')
        .eq('request_status', 'pending')
        .order('reschedule_request_time', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) {
        console.error('[cancellation] Failed to load pending log:', error.message);
        return null;
    }
    return data;
};

const usePendingCancellationLog = (bookingId, enabled = true) => {
    const [log, setLog] = useState(null);
    const [loading, setLoading] = useState(Boolean(enabled && bookingId));

    useEffect(() => {
        if (!enabled || !bookingId) {
            setLog(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        fetchPendingCancellationLog(bookingId).then((data) => {
            if (!cancelled) {
                setLog(data);
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [bookingId, enabled]);

    return { log, loading };
};

const formatCancellationFeeSummary = (log, booking = null) => {
    let hoursRaw = log?.hours_before_appointment;
    if ((hoursRaw == null || hoursRaw === '') && booking?.drop_off_date && log?.reschedule_request_time) {
        try {
            const appt = parseISO(booking.drop_off_date);
            const requested = parseISO(log.reschedule_request_time);
            if (isValid(appt) && isValid(requested)) {
                hoursRaw = Math.round((appt.getTime() - requested.getTime()) / (1000 * 60 * 60));
            }
        } catch { /* ignore */ }
    }
    const hours = hoursRaw != null && hoursRaw !== '' ? Math.max(0, Math.round(Number(hoursRaw))) : null;
    const isLate = log?.fee_type === 'late' || (hours != null && hours <= 24);
    const kind = isLate ? 'Late cancellation' : 'Advance cancellation';
    let pct = Number(log?.fee_percentage ?? 0);
    const maxFee = Number(log?.fee_amount ?? 0);
    const total = Number(booking?.total_price || 0);
    if ((!pct || pct === 0) && maxFee > 0 && total > 0) {
        pct = Number(((maxFee / total) * 100).toFixed(2));
    }
    return {
        feeTypeLine:
            hours != null
                ? `Cancelled ${hours} hours before appointment — ${kind}`
                : kind,
        percentageLabel: `${pct}%`,
        maxFeeLabel: `$${maxFee.toFixed(2)}`,
        hours,
        pct,
        maxFee,
        isLate,
    };
};

const CancellationPendingDetails = ({ booking }) => {
    const { log, loading } = usePendingCancellationLog(booking?.id, true);
    const summary = formatCancellationFeeSummary(log, booking);

    if (loading) {
        return (
            <div className="mt-3 rounded-md border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading cancellation details…
            </div>
        );
    }

    return (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-950/40 p-3 space-y-1">
            <p className="text-xs text-red-100"><span className="font-semibold text-red-300">Service:</span> {booking.plan?.name || 'Service'}</p>
            <p className="text-xs text-red-100"><span className="font-semibold text-red-300">Total Price:</span> ${(booking.total_price || 0).toFixed(2)}</p>
            <p className="text-xs text-red-100"><span className="font-semibold text-red-300">Fee Type:</span> {summary.feeTypeLine}</p>
            <p className="text-xs text-red-100"><span className="font-semibold text-red-300">Percentage Fee:</span> {summary.percentageLabel}</p>
            <p className="text-xs text-red-100"><span className="font-semibold text-red-300">Maximum Fee:</span> {summary.maxFeeLabel}</p>
            {log?.reschedule_request_time && (
                <p className="text-xs text-red-100"><span className="font-semibold text-red-300">Requested:</span> {format(parseISO(log.reschedule_request_time), 'MMM d, yyyy h:mm a')}</p>
            )}
            {booking.drop_off_date && (
                <p className="text-xs text-red-100"><span className="font-semibold text-red-300">Scheduled Date:</span> {format(parseISO(booking.drop_off_date), 'MMM d, yyyy')}</p>
            )}
        </div>
    );
};

const RefundDialog = ({ booking, customer, open, onOpenChange, onUpdate }) => {
    const [refundAmount, setRefundAmount] = useState(booking?.total_price || 0);
    const [cancellationFee, setCancellationFee] = useState(0);
    const [reason, setReason] = useState("Admin cancelled due to missing, not provided, or improper verification information.");
    const [isRefunding, setIsRefunding] = useState(false);
    const receiptRef = React.useRef();
    const paymentInfo = Array.isArray(booking?.stripe_payment_info) ? booking.stripe_payment_info[0] : booking?.stripe_payment_info;

    const handlePrint = useReactToPrint({
        content: () => receiptRef.current,
        documentTitle: `U-Fill-Refund-Receipt-${booking?.id || 'booking'}`,
    });
    
    React.useEffect(() => {
        if (booking) {
            const total = booking.total_price || 0;
            const fee = parseFloat(cancellationFee) || 0;
            setRefundAmount(Math.max(0, total - fee).toFixed(2));
        }
    }, [cancellationFee, booking]);

    const handleRefund = async () => {
        if (!paymentInfo?.stripe_charge_id) {
            toast({ title: "Refund Failed", description: "This booking is missing a Stripe Charge ID and cannot be refunded automatically.", variant: "destructive" });
            return;
        }
        setIsRefunding(true);
        try {
            const { error: refundError } = await supabase.functions.invoke('refund-payment', {
                body: {
                    bookingId: booking.id,
                    amount: parseFloat(refundAmount),
                    reason,
                    chargeId: paymentInfo.stripe_charge_id,
                }
            });

            if (refundError) throw refundError;
            expireActiveRentalAccessCodesForOrder(booking.id, 'admin');

            const refundMessage =
                `Your booking #${booking.id} has been cancelled. ` +
                `A refund of $${refundAmount} has been processed. Reason: ${reason}`;
            await supabase.from('chat_messages').insert({
                conversation_id: `cust_${customer.id}`,
                customer_id: customer.id,
                booking_id: booking.id,
                sender_type: 'admin',
                message_content: refundMessage,
                is_read: false,
                message_severity: 'urgent',
                message_context: {
                    action: 'booking_refund',
                    amount: parseFloat(refundAmount),
                    reason,
                    booking_id: booking.id,
                },
            });
            
            await supabase.functions.invoke('send-booking-confirmation', {
                body: { bookingId: booking.id }
            });
            
            toast({ title: "Refund Processed & Customer Notified", description: `Successfully refunded $${refundAmount}.` });

            onUpdate();
            onOpenChange(false);
        } catch (error) {
            toast({ title: "Refund Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsRefunding(false);
        }
    };

    if (!booking) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <div className="hidden">
                 <PrintableReceipt ref={receiptRef} booking={{...booking, customers: customer, status: 'Cancelled', refund_details: {amount: parseFloat(refundAmount), reason, created_at: new Date().toISOString()}}} />
            </div>
            <DialogContent className="bg-gray-900 border-red-500 text-white">
                <DialogHeader>
                    <DialogTitle>Cancel Booking & Issue Refund</DialogTitle>
                    <DialogDescription>
                        Booking #{booking.id} will be cancelled. Original total: ${booking.total_price.toFixed(2)}.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div>
                        <Label htmlFor="cancellation-fee">Cancellation / Admin Fee</Label>
                        <Input id="cancellation-fee" type="number" value={cancellationFee} onChange={(e) => setCancellationFee(e.target.value)} placeholder="0.00" className="bg-white/20"/>
                    </div>
                    <div>
                        <Label>Amount to Refund</Label>
                        <p className="text-2xl font-bold text-green-400">${refundAmount}</p>
                    </div>
                    <div>
                        <Label htmlFor="reason">Reason for Cancellation (will be sent to customer)</Label>
                        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="bg-white/20"/>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={handlePrint}>Print Refund Receipt</Button>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
                    <Button variant="destructive" onClick={handleRefund} disabled={isRefunding}>
                        {isRefunding ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <DollarSign className="mr-2 h-4 w-4"/>}
                        Confirm & Refund
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const getChargeDeltaInfo = (booking) => {
    const details = booking.payment_delta_details || {};
    const amountFromDetails = Number(details.amount_due || 0);
    const history = Array.isArray(booking.reschedule_history) ? booking.reschedule_history : [];
    const latestReschedule = history.length > 0 ? history[history.length - 1] : null;
    const amountFromHistory =
        latestReschedule && latestReschedule.new_total_price != null && latestReschedule.original_total_price != null
            ? Number(latestReschedule.new_total_price) - Number(latestReschedule.original_total_price)
            : 0;

    const amountDue = amountFromDetails > 0 ? amountFromDetails : Math.max(0, amountFromHistory);
    const originalTotal = details.original_total_price ?? latestReschedule?.original_total_price ?? booking.total_price ?? 0;
    const newTotal = details.new_total_price ?? latestReschedule?.new_total_price ?? booking.total_price ?? 0;

    return {
        amountDue,
        originalTotal: Number(originalTotal || 0),
        newTotal: Number(newTotal || 0),
        reason: details.reason || details.notes || 'Reschedule change requires payment adjustment.',
        state: details.state || 'pending',
        requestedAt: details.requested_at || details.last_updated_at || booking.reschedule_timestamp || booking.created_at,
    };
};

const formatMaybeDateTime = (value) => {
    if (!value) return 'N/A';
    const parsed = parseISO(String(value));
    if (!isValid(parsed)) return 'N/A';
    return format(parsed, 'PPP p');
};

const ChargeDifferenceDialog = ({ booking, customer, open, onOpenChange, onUpdate }) => {
    const initial = getChargeDeltaInfo(booking || {});
    const [amount, setAmount] = useState(initial.amountDue > 0 ? initial.amountDue.toFixed(2) : '0.00');
    const [reason, setReason] = useState(initial.reason);
    const [manualChargeId, setManualChargeId] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [manualRequired, setManualRequired] = useState(false);
    const [lastAutoError, setLastAutoError] = useState('');

    React.useEffect(() => {
        if (!booking) return;
        const next = getChargeDeltaInfo(booking);
        setAmount(next.amountDue > 0 ? next.amountDue.toFixed(2) : '0.00');
        setReason(next.reason);
        setManualChargeId('');
        setManualRequired(false);
        setLastAutoError('');
    }, [booking?.id, open]);

    if (!booking) return null;

    const handleAttemptCharge = async () => {
        const parsed = Number(amount);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            toast({ title: 'Invalid Amount', description: 'Amount to charge must be greater than $0.00.', variant: 'destructive' });
            return;
        }
        setIsProcessing(true);
        try {
            const { data, error } = await supabase.functions.invoke('charge-booking-difference', {
                body: {
                    bookingId: booking.id,
                    action: 'auto',
                    amount: parsed,
                    reason,
                },
            });
            if (error) throw error;

            if (data?.success) {
                toast({ title: 'Charge Successful', description: `Charged $${parsed.toFixed(2)} and marked booking confirmed.` });
                await expireActiveRentalAccessCodesForOrder(booking.id, 'admin');
                onUpdate();
                onOpenChange(false);
                return;
            }

            setManualRequired(true);
            setLastAutoError(data?.message || 'Auto-charge failed and manual fallback is required.');
            toast({
                title: 'Manual Follow-up Required',
                description: data?.message || 'Auto-charge was not completed. Record manual outcome below.',
                variant: 'destructive',
            });
        } catch (err) {
            setManualRequired(true);
            setLastAutoError(err.message);
            toast({ title: 'Auto-charge Failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleMarkManualSuccess = async () => {
        const parsed = Number(amount);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            toast({ title: 'Invalid Amount', description: 'Amount to charge must be greater than $0.00.', variant: 'destructive' });
            return;
        }
        setIsProcessing(true);
        try {
            const { error } = await supabase.functions.invoke('charge-booking-difference', {
                body: {
                    bookingId: booking.id,
                    action: 'manual_success',
                    amount: parsed,
                    reason,
                    manualChargeId: manualChargeId || null,
                },
            });
            if (error) throw error;
            toast({ title: 'Manual Charge Recorded', description: `Recorded manual charge of $${parsed.toFixed(2)}.` });
            await expireActiveRentalAccessCodesForOrder(booking.id, 'admin');
            onUpdate();
            onOpenChange(false);
        } catch (err) {
            toast({ title: 'Save Failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCancelCharge = async () => {
        const parsed = Number(amount);
        setIsProcessing(true);
        try {
            const { error } = await supabase.functions.invoke('charge-booking-difference', {
                body: {
                    bookingId: booking.id,
                    action: 'cancel',
                    amount: Number.isFinite(parsed) && parsed > 0 ? parsed : 0.01,
                    reason: reason || 'Charge approval cancelled by admin',
                },
            });
            if (error) throw error;
            toast({ title: 'Charge Cancelled', description: 'Customer was notified in chat with urgent action required.' });
            onUpdate();
            onOpenChange(false);
        } catch (err) {
            toast({ title: 'Cancellation Failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-yellow-400 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center">
                        <CreditCard className="mr-2 h-5 w-5 text-yellow-300" />
                        Charge Difference for Booking #{booking.id}
                    </DialogTitle>
                    <DialogDescription>
                        Review the payment adjustment and approve charge attempt. If it cannot be auto-charged, record manual outcome.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="rounded-md border border-yellow-500/30 bg-yellow-900/20 p-3 text-sm">
                        <p><strong>Customer:</strong> {customer?.name || 'N/A'}</p>
                        <p><strong>Original Total:</strong> ${getChargeDeltaInfo(booking).originalTotal.toFixed(2)}</p>
                        <p><strong>New Total:</strong> ${getChargeDeltaInfo(booking).newTotal.toFixed(2)}</p>
                        <p><strong>Requested:</strong> {formatMaybeDateTime(getChargeDeltaInfo(booking).requestedAt)}</p>
                    </div>

                    <div>
                        <Label htmlFor="delta-amount">Amount to Charge ($)</Label>
                        <Input
                            id="delta-amount"
                            type="number"
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="bg-white/20"
                        />
                    </div>
                    <div>
                        <Label htmlFor="delta-reason">Reason / Description</Label>
                        <Input
                            id="delta-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="bg-white/20"
                        />
                    </div>

                    {manualRequired && (
                        <div className="rounded-md border border-orange-500/40 bg-orange-900/20 p-3 space-y-2">
                            <p className="text-sm text-orange-200 font-semibold flex items-center">
                                <AlertTriangle className="h-4 w-4 mr-2" />
                                Auto-charge did not complete. Manual confirmation required.
                            </p>
                            {lastAutoError && <p className="text-xs text-orange-300">{lastAutoError}</p>}
                            <div>
                                <Label htmlFor="manual-charge-id">Manual Stripe Charge/PI ID (optional)</Label>
                                <Input
                                    id="manual-charge-id"
                                    value={manualChargeId}
                                    onChange={(e) => setManualChargeId(e.target.value)}
                                    placeholder="ch_... or pi_..."
                                    className="bg-white/20"
                                />
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="destructive" onClick={handleCancelCharge} disabled={isProcessing}>
                        Cancel Charge Request
                    </Button>
                    {manualRequired ? (
                        <Button className="bg-green-600 hover:bg-green-700" onClick={handleMarkManualSuccess} disabled={isProcessing}>
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Mark as Charged Manually
                        </Button>
                    ) : (
                        <Button className="bg-green-600 hover:bg-green-700" onClick={handleAttemptCharge} disabled={isProcessing}>
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Approve & Attempt Charge
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const CancellationApprovalDialog = ({ booking, customer, open, onOpenChange, onUpdate }) => {
    const [cancellationFee, setCancellationFee] = useState('');
    const [refundAmount, setRefundAmount] = useState(0);
    const [description, setDescription] = useState(DEFAULT_CANCELLATION_DESCRIPTION);
    const [isProcessing, setIsProcessing] = useState(false);
    const receiptRef = React.useRef();
    const { log: cancellationLog, loading: logLoading } = usePendingCancellationLog(booking?.id, open && !!booking);
    const summary = formatCancellationFeeSummary(cancellationLog, booking);

    const handlePrint = useReactToPrint({
        content: () => receiptRef.current,
        documentTitle: `U-Fill-Cancellation-Receipt-${booking?.id || 'booking'}`,
    });

    useEffect(() => {
        if (booking && open) {
            setCancellationFee(String(summary.maxFee || 0));
            setDescription(DEFAULT_CANCELLATION_DESCRIPTION);
        }
    }, [booking?.id, open, summary.maxFee]);

    useEffect(() => {
        const total = booking?.total_price || 0;
        const fee = parseFloat(cancellationFee) || 0;
        setRefundAmount(Math.max(0, total - fee));
    }, [cancellationFee, booking?.total_price]);

    const paymentInfo = Array.isArray(booking?.stripe_payment_info)
        ? booking.stripe_payment_info[0]
        : booking?.stripe_payment_info;

    const handleApprove = async () => {
        if (!paymentInfo?.stripe_charge_id) {
            toast({ title: 'Refund Failed', description: 'Missing Stripe Charge ID.', variant: 'destructive' });
            return;
        }
        setIsProcessing(true);
        try {
            const fee = parseFloat(cancellationFee) || 0;
            const refund = Math.max(0, (booking.total_price || 0) - fee);
            const reasonText = description.trim() || DEFAULT_CANCELLATION_DESCRIPTION;

            const { data: refundData, error: refundError } = await supabase.functions.invoke('refund-payment', {
                body: {
                    bookingId: booking.id,
                    amount: refund,
                    reason: reasonText,
                    chargeId: paymentInfo.stripe_charge_id,
                },
            });
            if (refundError) throw refundError;

            const now = new Date().toISOString();
            // Loyalty reverse runs in DB (cancel trigger + refund-payment RPC). Re-read addons so we don't clobber the reverse.
            const { data: refreshedBooking } = await supabase
                .from('bookings')
                .select('addons')
                .eq('id', booking.id)
                .maybeSingle();
            const refreshedAddons = refreshedBooking?.addons && typeof refreshedBooking.addons === 'object'
                ? refreshedBooking.addons
                : (booking.addons && typeof booking.addons === 'object' ? booking.addons : {});
            const pointsReversed = Number(
                refundData?.loyalty?.points_reversed
                || refreshedAddons.loyaltyPointsReversedOnCancel
                || 0
            );

            await supabase.from('bookings').update({
                cancellation_details: {
                    fee_type: cancellationLog?.fee_type || (summary.isLate ? 'late' : 'advance'),
                    fee_percentage: summary.pct,
                    fee_amount: fee,
                    refund_amount: refund,
                    reason: reasonText,
                    approved_at: now,
                    requested_at: cancellationLog?.reschedule_request_time || null,
                    hours_before_appointment: summary.hours,
                    loyalty_points_reversed: pointsReversed,
                },
                addons: {
                    ...refreshedAddons,
                    loyaltyPointsEarned: 0,
                    loyaltyPointsReversedOnCancel: Number(refreshedAddons.loyaltyPointsReversedOnCancel || pointsReversed || 0),
                },
            }).eq('id', booking.id);

            if (cancellationLog?.id) {
                await supabase.from('reschedule_history_logs').update({
                    request_status: 'approved',
                    admin_notes: reasonText,
                    resolved_at: now,
                    fee_amount: fee,
                }).eq('id', cancellationLog.id);
            }

            await expireActiveRentalAccessCodesForOrder(booking.id, 'admin');

            const chatMsg =
                `We're sorry to see you go! Your cancellation for Booking #${booking.id} has been approved. ` +
                `A refund of $${refund.toFixed(2)} has been processed` +
                (fee > 0 ? ` (cancellation fee: $${fee.toFixed(2)})` : '') +
                `. If you ever need our services again, we'd be more than happy to help!`;
            await supabase.from('chat_messages').insert({
                conversation_id: `cust_${customer.id}`,
                customer_id: customer.id,
                booking_id: booking.id,
                sender_type: 'admin',
                message_content: chatMsg,
                is_read: false,
                message_severity: 'urgent',
                message_context: { action: 'cancellation_approved', amount: refund, fee, booking_id: booking.id },
            });

            await supabase.from('customer_notes').insert({
                customer_id: customer.id,
                booking_id: booking.id,
                source: 'Cancellation Approved',
                content: `Cancellation approved. Fee: $${fee.toFixed(2)}, Refund: $${refund.toFixed(2)}. ${reasonText}${pointsReversed > 0 ? ` Loyalty points reversed: ${pointsReversed}.` : ''}`,
                author_type: 'admin',
                is_read: false,
            });

            await supabase.functions.invoke('send-booking-confirmation', {
                body: { bookingId: booking.id },
            });

            toast({ title: 'Cancellation Approved', description: `Refund of $${refund.toFixed(2)} processed.` });
            onUpdate();
            onOpenChange(false);
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    if (!booking) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <div className="hidden">
                <PrintableReceipt ref={receiptRef} booking={{
                    ...booking,
                    customers: customer,
                    status: 'Cancelled',
                    addons: { ...(booking.addons || {}), loyaltyPointsEarned: 0 },
                    refund_details: { amount: refundAmount, reason: description || DEFAULT_CANCELLATION_DESCRIPTION, created_at: new Date().toISOString() },
                    cancellation_details: {
                        fee_type: cancellationLog?.fee_type || (summary.isLate ? 'late' : 'advance'),
                        fee_percentage: summary.pct,
                        fee_amount: parseFloat(cancellationFee) || 0,
                        refund_amount: refundAmount,
                        reason: description || DEFAULT_CANCELLATION_DESCRIPTION,
                        hours_before_appointment: summary.hours,
                    },
                }} />
            </div>
            <DialogContent className="bg-gray-900 border-green-500 text-white max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-green-400 flex items-center gap-2">
                        <CheckCircle className="h-5 w-5" /> Approve Cancellation
                    </DialogTitle>
                    <DialogDescription>
                        Booking #{booking.id} — Original total: ${(booking.total_price || 0).toFixed(2)}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="rounded-lg bg-amber-900/30 border border-amber-500/40 p-3 text-sm space-y-1">
                        {logLoading ? (
                            <p className="text-amber-200 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading fee details…</p>
                        ) : (
                            <>
                                <p className="text-amber-200"><strong>Fee Type:</strong> {summary.feeTypeLine}</p>
                                <p className="text-amber-200"><strong>Percentage Fee:</strong> {summary.percentageLabel}</p>
                                <p className="text-amber-200"><strong>Maximum Fee:</strong> {summary.maxFeeLabel}</p>
                            </>
                        )}
                        {cancellationLog?.reschedule_request_time && (
                            <p className="text-amber-200 mt-1"><strong>Requested:</strong> {format(parseISO(cancellationLog.reschedule_request_time), 'MMM d, yyyy h:mm a')}</p>
                        )}
                    </div>
                    <div>
                        <Label htmlFor="cancel-fee">Cancellation Fee (adjustable)</Label>
                        <Input id="cancel-fee" type="number" step="0.01" value={cancellationFee} onChange={(e) => setCancellationFee(e.target.value)} placeholder="0.00" className="bg-white/20" />
                    </div>
                    <div>
                        <Label>Amount to Refund</Label>
                        <p className="text-2xl font-bold text-green-400">${refundAmount.toFixed(2)}</p>
                    </div>
                    <div>
                        <Label htmlFor="cancel-desc">Description / Reason (optional)</Label>
                        <textarea
                            id="cancel-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            className="w-full bg-white/20 border border-white/10 rounded-md p-2 text-white text-sm placeholder:text-gray-500"
                            placeholder={DEFAULT_CANCELLATION_DESCRIPTION}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handlePrint}>Print Receipt</Button>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button className="bg-green-600 hover:bg-green-700" onClick={handleApprove} disabled={isProcessing || logLoading}>
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                        Confirm & Process Refund
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const CancellationRejectionDialog = ({ booking, customer, open, onOpenChange, onUpdate }) => {
    const [reason, setReason] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const { log: cancellationLog } = usePendingCancellationLog(booking?.id, open && !!booking);

    const handleReject = async () => {
        setIsProcessing(true);
        try {
            const previousStatus = cancellationLog?.previous_status || 'Confirmed';
            const now = new Date().toISOString();

            await supabase.from('bookings').update({
                status: previousStatus,
                ...reinstatePinTrackingPatch('cancellation_pending', previousStatus),
            }).eq('id', booking.id);

            if (cancellationLog?.id) {
                await supabase.from('reschedule_history_logs').update({
                    request_status: 'rejected',
                    admin_notes: reason || 'Cancellation rejected by admin.',
                    resolved_at: now,
                }).eq('id', cancellationLog.id);
            }

            const chatMsg =
                `We've reviewed your cancellation request for Booking #${booking.id}. ` +
                `Unfortunately, we're unable to process the cancellation at this time. ` +
                `The full amount will remain charged as the service window has passed. ` +
                `If you have any questions, please don't hesitate to reach out.`;
            await supabase.from('chat_messages').insert({
                conversation_id: `cust_${customer.id}`,
                customer_id: customer.id,
                booking_id: booking.id,
                sender_type: 'admin',
                message_content: chatMsg,
                is_read: false,
                message_severity: 'info',
                message_context: { action: 'cancellation_rejected', booking_id: booking.id },
            });

            await supabase.from('customer_notes').insert({
                customer_id: customer.id,
                booking_id: booking.id,
                source: 'Cancellation Rejected',
                content: `Cancellation rejected. ${reason ? 'Reason: ' + reason : 'No reason provided.'} Booking restored to ${previousStatus}.`,
                author_type: 'admin',
                is_read: false,
            });

            toast({ title: 'Cancellation Rejected', description: `Booking restored to ${previousStatus}.` });
            onUpdate();
            onOpenChange(false);
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    if (!booking) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-red-500 text-white max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-red-400 flex items-center gap-2">
                        <Ban className="h-5 w-5" /> Reject Cancellation
                    </DialogTitle>
                    <DialogDescription>
                        Booking #{booking.id} will be restored. The customer will be notified that the full charge stands.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <p className="text-sm text-gray-300">
                        The booking status will be restored to <strong className="text-white">{cancellationLog?.previous_status || 'Confirmed'}</strong> and
                        the customer will be notified that their cancellation request was rejected.
                    </p>
                    <div>
                        <Label htmlFor="reject-reason">Reason (optional)</Label>
                        <textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full bg-white/20 border border-white/10 rounded-md p-2 text-white text-sm placeholder:text-gray-500" placeholder="Optional reason for rejection..." />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={handleReject} disabled={isProcessing}>
                        {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                        Confirm Rejection
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export const CustomerVerification = ({ customer, verificationBookings, notes, onUpdate }) => {
    const [selectedBookingForRefund, setSelectedBookingForRefund] = useState(null);
    const [selectedBookingForCharge, setSelectedBookingForCharge] = useState(null);
    const [selectedBookingForCancelApproval, setSelectedBookingForCancelApproval] = useState(null);
    const [selectedBookingForCancelRejection, setSelectedBookingForCancelRejection] = useState(null);
    const [isEditingPlate, setIsEditingPlate] = useState(false);
    const [plate, setPlate] = useState(customer?.license_plate || '');
    const [isSavingPlate, setIsSavingPlate] = useState(false);
    const [isProcessingStatus, setIsProcessingStatus] = useState(false);

    const { history, loading: historyLoading } = useVerificationImageHistory(customer?.id);

    const handleSavePlate = async () => {
        if (!customer?.id) return;
        setIsSavingPlate(true);
        const { error } = await supabase
            .from('customers')
            .update({ license_plate: plate })
            .eq('id', customer.id);
        
        if (error) {
            toast({ title: "Error saving license plate", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "License plate updated!" });
            onUpdate();
            setIsEditingPlate(false);
        }
        setIsSavingPlate(false);
    };

    const handleUpdateDocStatus = async (status) => {
        if (!customer?.id) return;
        setIsProcessingStatus(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            await updateVerificationStatus(customer.id, status, user?.id);
            toast({ title: "Status Updated", description: `Verification status set to ${status}.` });
            onUpdate(); // Trigger refresh which cascades
        } catch (error) {
            toast({ title: "Error updating status", description: error.message, variant: "destructive" });
        } finally {
            setIsProcessingStatus(false);
        }
    };
    
    const handleApprove = async (booking) => {
        if (!customer?.id) return;
        const prevStatus = booking.status;
        const pendingAddress = getPendingAddressChange(booking.reschedule_history);
        const toAddress = normalizeAddress(pendingAddress?.to_address);
        const fromAddress = normalizeAddress(pendingAddress?.from_address);
        const approvedAt = new Date().toISOString();

        const bookingUpdate = {
            status: 'Confirmed',
            verification_notes: 'Admin approved verification.',
            is_manually_verified: true,
            ...reinstatePinTrackingPatch(prevStatus, 'Confirmed'),
        };

        if (toAddress) {
            const addressPayload = {
                street: toAddress.street,
                city: toAddress.city,
                state: toAddress.state,
                zip: toAddress.zip,
                formatted_address: toAddress.formatted_address,
                isVerified: !pendingAddress?.is_manual_address,
            };
            bookingUpdate.street = toAddress.street;
            bookingUpdate.city = toAddress.city;
            bookingUpdate.state = toAddress.state;
            bookingUpdate.zip = toAddress.zip;
            bookingUpdate.delivery_address = addressPayload;
            bookingUpdate.contact_address = addressPayload;
            if (pendingAddress?.distance_miles != null && pendingAddress.distance_miles !== '') {
                bookingUpdate.distance_miles = Number(pendingAddress.distance_miles);
            }
            bookingUpdate.reschedule_history = markAddressChangesApproved(
                booking.reschedule_history,
                approvedAt
            );
        }

        const { error } = await supabase
            .from('bookings')
            .update(bookingUpdate)
            .eq('id', booking.id);
            
        if (error) {
            toast({ title: "Approval Failed", description: error.message, variant: 'destructive' });
        } else {
            if (toAddress) {
                const customerUpdate = {
                    street: toAddress.street,
                    city: toAddress.city,
                    state: toAddress.state,
                    zip: toAddress.zip,
                    unverified_address: Boolean(pendingAddress?.is_manual_address),
                };
                if (pendingAddress?.distance_miles != null && pendingAddress.distance_miles !== '') {
                    customerUpdate.distance_miles = Number(pendingAddress.distance_miles);
                    customerUpdate.travel_time_minutes = null;
                } else {
                    customerUpdate.distance_miles = null;
                    customerUpdate.travel_time_minutes = null;
                }

                const { error: customerError } = await supabase
                    .from('customers')
                    .update(customerUpdate)
                    .eq('id', customer.id);

                if (customerError) {
                    console.error('Failed to update customer address on approve:', customerError.message);
                    toast({
                        title: 'Address partially applied',
                        description: 'Booking was approved but the customer profile address could not be updated.',
                        variant: 'destructive',
                    });
                }

                const fromDisplay = formatAddressDisplay(fromAddress) || 'N/A';
                const toDisplay = formatAddressDisplay(toAddress);
                await supabase.from('customer_notes').insert({
                    customer_id: customer.id,
                    booking_id: booking.id,
                    source: 'Address Change',
                    content: `Address updated via reschedule approval for booking #${booking.id}.\nFrom: ${fromDisplay}\nTo: ${toDisplay}`,
                    author_type: 'admin',
                    is_read: false,
                });
            }

            if (prevStatus === 'pending_review') {
                await expireActiveRentalAccessCodesForOrder(booking.id);
            }
            await supabase.functions.invoke('send-booking-confirmation', {
                body: { bookingId: booking.id }
            });
            toast({ title: "Booking Approved", description: `The booking is now confirmed and the customer has been notified.` });
            onUpdate();
        }
    };

    const handleCancelClick = (booking) => {
        setSelectedBookingForRefund(booking);
    };

    const getVerificationCardStyles = (status) => {
        switch (status) {
            case 'pending_review':
                return {
                    container: "bg-orange-900/30 border-orange-500",
                    title: "text-orange-300 font-bold",
                    icon: <MessageSquare className="mr-2 h-4 w-4"/>,
                    titleText: "Change Request for Booking #",
                    nextStep: "Review change details, then approve booking or cancel/refund."
                };
            case 'pending_payment':
                 return {
                    container: "bg-red-900/30 border-red-500",
                    title: "text-red-300 font-bold",
                    icon: <DollarSign className="mr-2 h-4 w-4"/>,
                    titleText: "Payment Difference Pending for Booking #",
                    nextStep: "Open charge dialog, attempt auto-charge, then confirm or cancel with reason."
                };
            case 'cancellation_pending':
                return {
                    container: "bg-red-900/40 border-red-600",
                    title: "text-red-300 font-bold",
                    icon: <Ban className="mr-2 h-4 w-4"/>,
                    titleText: "Cancellation Request for Booking #",
                    nextStep: "Review cancellation details and fee, then approve or reject."
                };
            default:
                return {
                    container: "bg-orange-900/30 border-orange-500",
                    title: "text-orange-300 font-bold",
                    icon: <FileText className="mr-2 h-4 w-4"/>,
                    titleText: "New Booking Verification #",
                    nextStep: "Verify customer docs and approve/reject."
                };
        }
    };

    const verificationNotes = useMemo(() => {
        const noteMap = {};
        if (notes) {
            for (const note of notes) {
                if (note.booking_id && (note.source === 'Change Request' || note.source === 'Verification Skip Reason' || note.source === 'Booking Special Instructions' || note.source === 'Cancellation Request')) {
                    if (!noteMap[note.booking_id]) {
                        noteMap[note.booking_id] = [];
                    }
                    noteMap[note.booking_id].push({content: note.content, source: note.source});
                }
            }
        }
        return noteMap;
    }, [notes]);
    
    const getPendingPaymentSummary = (booking) => {
        const details = getChargeDeltaInfo(booking);
        return [
            {
                label: 'Amount to Charge',
                value: `$${details.amountDue.toFixed(2)}`,
            },
            {
                label: 'Original Total',
                value: `$${details.originalTotal.toFixed(2)}`,
            },
            {
                label: 'New Total',
                value: `$${details.newTotal.toFixed(2)}`,
            },
            {
                label: 'Reason',
                value: details.reason,
            },
            {
                label: 'State',
                value: details.state,
            },
        ];
    };

    return (
        <>
        <RefundDialog booking={selectedBookingForRefund} customer={customer} open={!!selectedBookingForRefund} onOpenChange={() => setSelectedBookingForRefund(null)} onUpdate={onUpdate} />
        {selectedBookingForCharge && (
            <ChargeDifferenceDialog
                booking={selectedBookingForCharge}
                customer={customer}
                open={!!selectedBookingForCharge}
                onOpenChange={() => setSelectedBookingForCharge(null)}
                onUpdate={onUpdate}
            />
        )}
        <CancellationApprovalDialog
            booking={selectedBookingForCancelApproval}
            customer={customer}
            open={!!selectedBookingForCancelApproval}
            onOpenChange={() => setSelectedBookingForCancelApproval(null)}
            onUpdate={onUpdate}
        />
        <CancellationRejectionDialog
            booking={selectedBookingForCancelRejection}
            customer={customer}
            open={!!selectedBookingForCancelRejection}
            onOpenChange={() => setSelectedBookingForCancelRejection(null)}
            onUpdate={onUpdate}
        />
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white/5 p-6 rounded-lg shadow-lg space-y-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="flex items-center text-xl font-bold text-yellow-400"><Car className="mr-3 h-6 w-6"/>Vehicle & License Details</h3>
                </div>
                
                <div>
                    <div className="flex justify-between items-center">
                        <p className="font-semibold text-blue-200">License Plate:</p>
                        {isEditingPlate ? (
                            <div className="flex items-center gap-2">
                                <Button size="sm" onClick={handleSavePlate} disabled={isSavingPlate}>
                                    {isSavingPlate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setIsEditingPlate(false)}><X className="h-4 w-4" /></Button>
                            </div>
                        ) : (
                            <Button size="sm" variant="outline" onClick={() => setIsEditingPlate(true)}><Edit className="mr-2 h-4 w-4" /> Edit</Button>
                        )}
                    </div>
                    {isEditingPlate ? (
                        <Input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className="font-mono text-lg mt-2" />
                    ) : (
                        <p className="text-white font-mono text-lg bg-white/10 p-2 rounded-md mt-2">{plate || 'Not Provided'}</p>
                    )}
                </div>
                
                <div className="pt-4 border-t border-white/10">
                    <VerificationImageDisplay customerId={customer?.id} title="Driver & Insurance Documents" />
                    
                    <div className="mt-4 flex justify-end gap-2">
                        <Button variant="destructive" size="sm" onClick={() => handleUpdateDocStatus('rejected')} disabled={isProcessingStatus}>
                            <X className="mr-2 h-4 w-4" /> Reject Docs
                        </Button>
                        <Button className="bg-green-600 hover:bg-green-700" size="sm" onClick={() => handleUpdateDocStatus('approved')} disabled={isProcessingStatus}>
                            <CheckCircle className="mr-2 h-4 w-4" /> Approve Docs
                        </Button>
                    </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                    <h4 className="font-semibold text-blue-200 flex items-center mb-3">
                        <History className="h-4 w-4 mr-2" /> Audit Trail
                    </h4>
                    {historyLoading ? (
                        <div className="flex items-center text-gray-400"><Loader2 className="animate-spin h-4 w-4 mr-2" /> Loading history...</div>
                    ) : history.length > 0 ? (
                        <div className="space-y-3 max-h-48 overflow-y-auto pr-2">
                            {history.map(item => (
                                <div key={item.id} className="bg-black/20 p-2 rounded text-xs">
                                    <div className="flex justify-between items-center text-gray-300">
                                        <span className="font-medium text-yellow-400">{item.image_type}</span>
                                        <span>{format(parseISO(item.created_at), 'MMM d, yyyy h:mm a')}</span>
                                    </div>
                                    <p className="text-gray-400 mt-1 capitalize">Action: {item.action}</p>
                                    <a href={item.display_url || item.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline mt-1 inline-block">View Version</a>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400">No history records found.</p>
                    )}
                </div>
            </div>

            <div className="bg-white/5 p-6 rounded-lg shadow-lg">
                <h3 className="flex items-center text-xl font-bold text-yellow-400 mb-4"><ShieldAlert className="mr-3 h-6 w-6"/>Pending Booking Verifications</h3>
                 <div className="space-y-4">
                    {verificationBookings?.length > 0 ? verificationBookings.map(booking => {
                        const styles = getVerificationCardStyles(booking.status);
                        const requestNotes = verificationNotes[booking.id] || [];
                        const pendingAddress = booking.status === 'pending_review'
                            ? getPendingAddressChange(booking.reschedule_history)
                            : null;
                        const currentAddressDisplay = formatAddressDisplay(pendingAddress?.from_address) ||
                            formatAddressDisplay(booking.delivery_address || booking.contact_address) ||
                            formatAddressDisplay({
                                street: booking.street,
                                city: booking.city,
                                state: booking.state,
                                zip: booking.zip,
                            }) ||
                            'N/A';
                        const requestedAddressDisplay = formatAddressDisplay(pendingAddress?.to_address);
                        return (
                            <div key={booking.id} className={`${styles.container} p-4 rounded-lg`}>
                                <p className={styles.title}>{styles.titleText}{booking.id}</p>
                                <p className="text-xs text-yellow-200 mt-2">
                                    <strong>Next step:</strong> {styles.nextStep}
                                </p>
                                {pendingAddress && requestedAddressDisplay && (
                                    <div className="mt-3 rounded-md border border-orange-500/40 bg-black/20 p-3 space-y-2">
                                        <p className="text-xs font-semibold text-orange-200 flex items-center">
                                            <MapPin className="h-3.5 w-3.5 mr-1.5" />
                                            Requested Address Change
                                            {pendingAddress.is_manual_address ? ' (manual entry)' : ''}
                                        </p>
                                        <p className="text-xs text-gray-300">
                                            <span className="font-semibold text-gray-400">Current:</span> {currentAddressDisplay}
                                        </p>
                                        <p className="text-xs text-orange-100">
                                            <span className="font-semibold text-orange-300">Requested:</span> {requestedAddressDisplay}
                                        </p>
                                    </div>
                                )}
                                {requestNotes.length > 0 && (
                                    <div className="mt-2 space-y-2">
                                         {requestNotes.map((note, i) => (
                                            <div key={i} className="mt-1">
                                                <p className="font-semibold text-blue-200 flex items-center">{styles.icon}{note.source}:</p>
                                                <p className="text-orange-200 italic bg-black/20 p-2 rounded-md mt-1">"{note.content}"</p>
                                            </div>
                                         ))}
                                    </div>
                                )}
                                {booking.status === 'pending_payment' && (
                                    <div className="mt-3 rounded-md border border-red-500/40 bg-red-950/40 p-3 space-y-1">
                                        {getPendingPaymentSummary(booking).map((item) => (
                                            <p key={item.label} className="text-xs text-red-100">
                                                <span className="font-semibold text-red-300">{item.label}:</span> {item.value}
                                            </p>
                                        ))}
                                    </div>
                                )}
                                {booking.status === 'cancellation_pending' && (
                                    <CancellationPendingDetails booking={booking} />
                                )}
                                <div className="flex justify-end space-x-2 mt-4">
                                    {booking.status === 'pending_payment' ? (
                                        <>
                                            <Button size="sm" variant="destructive" onClick={() => setSelectedBookingForCharge(booking)}>Charge / Cancel</Button>
                                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setSelectedBookingForCharge(booking)}>
                                                Open Charge Dialog
                                            </Button>
                                        </>
                                    ) : booking.status === 'cancellation_pending' ? (
                                        <>
                                            <Button size="sm" variant="destructive" onClick={() => setSelectedBookingForCancelRejection(booking)}><Ban className="mr-2 h-4 w-4"/>Reject Cancellation</Button>
                                            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => setSelectedBookingForCancelApproval(booking)}><CheckCircle className="mr-2 h-4 w-4"/>Approve Cancellation</Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button size="sm" variant="destructive" onClick={() => handleCancelClick(booking)}><X className="mr-2 h-4 w-4"/>Cancel & Refund</Button>
                                            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleApprove(booking)}><Check className="mr-2 h-4 w-4"/>Approve Booking</Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    }) : (
                        <p className="text-center text-blue-200 py-8 bg-black/20 rounded-lg border border-white/5">No bookings are pending verification.</p>
                    )}
                </div>
            </div>
        </div>
        </>
    );
};
