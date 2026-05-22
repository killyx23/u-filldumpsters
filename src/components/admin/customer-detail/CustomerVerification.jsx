
import React, { useState, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Car, ShieldAlert, FileText, Check, X, DollarSign, Loader2, Edit, Save, MessageSquare, CheckCircle, History, AlertTriangle, CreditCard } from 'lucide-react';
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
            
            const updatedBookingForEmail = {
                ...booking, 
                customers: customer, 
                status: 'Cancelled', 
                refund_details: { amount: parseFloat(refundAmount), reason, created_at: new Date().toISOString() }
            };
            
            await supabase.functions.invoke('send-booking-confirmation', {
                body: { booking: updatedBookingForEmail, customMessage: `This booking has been cancelled and a refund of $${refundAmount} has been processed. Reason: ${reason}` }
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

export const CustomerVerification = ({ customer, verificationBookings, notes, onUpdate }) => {
    const [selectedBookingForRefund, setSelectedBookingForRefund] = useState(null);
    const [selectedBookingForCharge, setSelectedBookingForCharge] = useState(null);
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
        const { error } = await supabase
            .from('bookings')
            .update({
                status: 'Confirmed',
                verification_notes: 'Admin approved verification.',
                is_manually_verified: true,
                ...reinstatePinTrackingPatch(prevStatus, 'Confirmed'),
            })
            .eq('id', booking.id);
            
        if (error) {
            toast({ title: "Approval Failed", description: error.message, variant: 'destructive' });
        } else {
            if (prevStatus === 'pending_review') {
                await expireActiveRentalAccessCodesForOrder(booking.id);
            }
            const updatedBookingForEmail = { ...booking, customers: customer, status: 'Confirmed' };
            await supabase.functions.invoke('send-booking-confirmation', {
                body: { booking: updatedBookingForEmail, customMessage: `Your booking #${booking.id} has been approved and is now confirmed.` }
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
                if (note.booking_id && (note.source === 'Change Request' || note.source === 'Verification Skip Reason' || note.source === 'Booking Special Instructions')) {
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
                    <VerificationImageDisplay customerId={customer?.id} />
                    
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
                                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline mt-1 inline-block">View Version</a>
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
                        return (
                            <div key={booking.id} className={`${styles.container} p-4 rounded-lg`}>
                                <p className={styles.title}>{styles.titleText}{booking.id}</p>
                                <p className="text-xs text-yellow-200 mt-2">
                                    <strong>Next step:</strong> {styles.nextStep}
                                </p>
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
                                <div className="flex justify-end space-x-2 mt-4">
                                    {booking.status === 'pending_payment' ? (
                                        <>
                                            <Button size="sm" variant="destructive" onClick={() => setSelectedBookingForCharge(booking)}>Charge / Cancel</Button>
                                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setSelectedBookingForCharge(booking)}>
                                                Open Charge Dialog
                                            </Button>
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
