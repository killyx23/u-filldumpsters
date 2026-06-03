import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Trash2, Calendar, XCircle } from 'lucide-react';
import { SecureDeleteFlow } from '@/components/admin/SecureDeleteDialog';
import { RescheduleDialog } from '@/components/customer-portal/reschedule/RescheduleDialog';
import { buildArchiveDetails, getStripeChargeId } from '@/utils/bookingArchiveHelper';
import { expireActiveRentalAccessCodesForOrder } from '@/utils/bookingPinReinstate';

const REASONS = {
    CANCELLED: 'cancelled',
    RESCHEDULED: 'rescheduled',
    DELETE: 'delete',
};

const RescheduleInitiatedByDialog = ({ booking, adminEmail, onClose, onInitiated }) => {
    const [initiatedBy, setInitiatedBy] = useState('admin');

    return (
        <Dialog open onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
            <DialogContent className="bg-gray-900 text-white border-gray-700 max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-blue-400">Reschedule Booking #{booking.id}</DialogTitle>
                    <DialogDescription className="text-gray-300">
                        Who is this reschedule for? You will enter the new booking details on behalf of the customer.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <RadioGroup value={initiatedBy} onValueChange={setInitiatedBy} className="space-y-2">
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="customer" id="resched-customer" />
                            <Label htmlFor="resched-customer" className="font-normal cursor-pointer">
                                Customer (phone request)
                            </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="admin" id="resched-admin" />
                            <Label htmlFor="resched-admin" className="font-normal cursor-pointer">
                                Admin manual reschedule{adminEmail ? ` (${adminEmail})` : ''}
                            </Label>
                        </div>
                    </RadioGroup>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => onInitiated(initiatedBy)}>Continue to Reschedule</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

/**
 * Shared removal flow: reason → cancel (optional refund) / reschedule wizard / secure delete.
 */
export const BookingRemovalDialog = ({
    booking,
    adminEmail,
    trigger = 'button',
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
    onComplete,
    onHardDeleted,
}) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = isControlled ? controlledOnOpenChange : setInternalOpen;
    const [step, setStep] = useState('reason');
    const [selectedReason, setSelectedReason] = useState(null);
    const [initiatedBy, setInitiatedBy] = useState('admin');
    const [processRefund, setProcessRefund] = useState(false);
    const [refundAmount, setRefundAmount] = useState('');
    const [refundReason, setRefundReason] = useState('Admin cancelled booking.');
    const [cancelNotes, setCancelNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSecureDelete, setShowSecureDelete] = useState(false);
    const [showRescheduleInit, setShowRescheduleInit] = useState(false);
    const [showRescheduleWizard, setShowRescheduleWizard] = useState(false);

    useEffect(() => {
        if (open && booking) {
            setStep('reason');
            setSelectedReason(null);
            setRefundAmount(booking.total_price != null ? Number(booking.total_price).toFixed(2) : '');
        }
    }, [open, booking?.id]);

    const resetState = () => {
        setStep('reason');
        setSelectedReason(null);
        setInitiatedBy('admin');
        setProcessRefund(false);
        setRefundAmount(booking?.total_price != null ? Number(booking.total_price).toFixed(2) : '');
        setRefundReason('Admin cancelled booking.');
        setCancelNotes('');
        setIsSubmitting(false);
        setShowSecureDelete(false);
        setShowRescheduleInit(false);
        setShowRescheduleWizard(false);
    };

    const handleOpen = (e) => {
        e?.stopPropagation?.();
        resetState();
        setRefundAmount(booking?.total_price != null ? Number(booking.total_price).toFixed(2) : '');
        setOpen(true);
    };

    const handleClose = () => {
        setOpen(false);
        resetState();
    };

    const handleReasonContinue = () => {
        if (!selectedReason) {
            toast({ title: 'Selection Required', description: 'Please choose why this booking is being removed.', variant: 'destructive' });
            return;
        }
        if (selectedReason === REASONS.DELETE) {
            setShowSecureDelete(true);
            return;
        }
        if (selectedReason === REASONS.RESCHEDULED) {
            setShowRescheduleInit(true);
            return;
        }
        setStep('cancel-details');
    };

    const handleCancelConfirm = async () => {
        if (!booking) return;
        setIsSubmitting(true);

        try {
            const stripeChargeId = getStripeChargeId(booking);
            const paymentInfo = Array.isArray(booking.stripe_payment_info)
                ? booking.stripe_payment_info[0]
                : booking.stripe_payment_info;

            const archiveDetails = buildArchiveDetails({
                action: 'cancelled',
                initiatedBy,
                adminEmail,
                booking,
                stripeChargeId,
                notes: cancelNotes || refundReason,
            });

            if (processRefund) {
                if (!paymentInfo?.stripe_charge_id) {
                    throw new Error('This booking is missing a Stripe Charge ID and cannot be refunded automatically.');
                }
                const amount = parseFloat(refundAmount);
                if (!Number.isFinite(amount) || amount < 0) {
                    throw new Error('Please enter a valid refund amount.');
                }

                const { error: refundError } = await supabase.functions.invoke('refund-payment', {
                    body: {
                        bookingId: booking.id,
                        amount,
                        reason: refundReason,
                        chargeId: paymentInfo.stripe_charge_id,
                    },
                });
                if (refundError) throw refundError;

                const { error: archiveError } = await supabase
                    .from('bookings')
                    .update({ archive_details: archiveDetails })
                    .eq('id', booking.id);
                if (archiveError) throw archiveError;
            } else {
                const { error: updateError } = await supabase
                    .from('bookings')
                    .update({
                        status: 'Cancelled',
                        archive_details: archiveDetails,
                    })
                    .eq('id', booking.id);
                if (updateError) throw updateError;
            }

            await expireActiveRentalAccessCodesForOrder(booking.id, 'admin');

            toast({
                title: 'Booking Cancelled',
                description: processRefund
                    ? `Booking #${booking.id} cancelled and refund processed.`
                    : `Booking #${booking.id} has been marked as cancelled.`,
            });

            onComplete?.({ action: 'cancelled', bookingId: booking.id });
            handleClose();
        } catch (err) {
            toast({ title: 'Cancellation Failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRescheduleComplete = (result) => {
        expireActiveRentalAccessCodesForOrder(booking.id, 'admin');
        onComplete?.({
            action: 'rescheduled',
            bookingId: booking.id,
            newBookingId: result?.newBookingId,
        });
        handleClose();
    };

    if (!booking) return null;

    const subFlowActive = showSecureDelete || showRescheduleInit || showRescheduleWizard;
    const showTrigger = !isControlled;

    return (
        <>
            {showTrigger && (trigger === 'icon' ? (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleOpen}
                    className="text-red-400 hover:text-red-300 hover:bg-red-400/20"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            ) : (
                <Button size="sm" variant="destructive" onClick={handleOpen}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
            ))}

            <Dialog open={open && !subFlowActive} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); else setOpen(true); }}>
                <DialogContent className="bg-gray-900 text-white border-gray-700 max-w-lg">
                    {step === 'reason' && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="text-yellow-400">
                                    Remove Booking #{booking.id}
                                </DialogTitle>
                                <DialogDescription className="text-gray-300">
                                    Why is this booking being removed?
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-3 py-4">
                                <Button
                                    variant="outline"
                                    className={`w-full justify-start h-auto py-3 ${selectedReason === REASONS.CANCELLED ? 'border-red-500 bg-red-500/10' : 'border-gray-600'}`}
                                    onClick={() => setSelectedReason(REASONS.CANCELLED)}
                                >
                                    <XCircle className="mr-3 h-5 w-5 text-red-400 flex-shrink-0" />
                                    <div className="text-left">
                                        <p className="font-semibold text-white">Canceled</p>
                                        <p className="text-xs text-gray-400">Mark as cancelled and log in History & Receipts</p>
                                    </div>
                                </Button>
                                <Button
                                    variant="outline"
                                    className={`w-full justify-start h-auto py-3 ${selectedReason === REASONS.RESCHEDULED ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600'}`}
                                    onClick={() => setSelectedReason(REASONS.RESCHEDULED)}
                                >
                                    <Calendar className="mr-3 h-5 w-5 text-blue-400 flex-shrink-0" />
                                    <div className="text-left">
                                        <p className="font-semibold text-white">Rescheduled</p>
                                        <p className="text-xs text-gray-400">Enter new dates and create a linked booking</p>
                                    </div>
                                </Button>
                                <Button
                                    variant="outline"
                                    className={`w-full justify-start h-auto py-3 ${selectedReason === REASONS.DELETE ? 'border-red-700 bg-red-900/20' : 'border-gray-600'}`}
                                    onClick={() => setSelectedReason(REASONS.DELETE)}
                                >
                                    <Trash2 className="mr-3 h-5 w-5 text-red-500 flex-shrink-0" />
                                    <div className="text-left">
                                        <p className="font-semibold text-white">Just Delete</p>
                                        <p className="text-xs text-gray-400">Permanently remove all records (password required)</p>
                                    </div>
                                </Button>
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                                <Button onClick={handleReasonContinue}>Continue</Button>
                            </DialogFooter>
                        </>
                    )}

                    {step === 'cancel-details' && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="text-red-400">Cancel Booking #{booking.id}</DialogTitle>
                                <DialogDescription className="text-gray-300">
                                    This will archive the booking in History & Receipts with full audit details.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div>
                                    <Label className="text-gray-300 mb-2 block">Who initiated the cancellation?</Label>
                                    <RadioGroup value={initiatedBy} onValueChange={setInitiatedBy} className="space-y-2">
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="customer" id="init-customer" />
                                            <Label htmlFor="init-customer" className="font-normal cursor-pointer">Customer</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="admin" id="init-admin" />
                                            <Label htmlFor="init-admin" className="font-normal cursor-pointer">Admin</Label>
                                        </div>
                                    </RadioGroup>
                                </div>

                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="process-refund"
                                        checked={processRefund}
                                        onCheckedChange={(checked) => setProcessRefund(Boolean(checked))}
                                    />
                                    <Label htmlFor="process-refund" className="font-normal cursor-pointer">
                                        Process refund now?
                                    </Label>
                                </div>

                                {processRefund && (
                                    <div className="space-y-3 pl-6 border-l-2 border-red-500/30">
                                        <div>
                                            <Label htmlFor="refund-amount">Refund Amount ($)</Label>
                                            <Input
                                                id="refund-amount"
                                                type="number"
                                                step="0.01"
                                                value={refundAmount}
                                                onChange={(e) => setRefundAmount(e.target.value)}
                                                className="bg-white/20"
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor="refund-reason">Refund Reason</Label>
                                            <Input
                                                id="refund-reason"
                                                value={refundReason}
                                                onChange={(e) => setRefundReason(e.target.value)}
                                                className="bg-white/20"
                                            />
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <Label htmlFor="cancel-notes">Notes (optional)</Label>
                                    <Input
                                        id="cancel-notes"
                                        value={cancelNotes}
                                        onChange={(e) => setCancelNotes(e.target.value)}
                                        placeholder="Additional context for the audit log"
                                        className="bg-white/20"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={() => setStep('reason')}>Back</Button>
                                <Button variant="destructive" onClick={handleCancelConfirm} disabled={isSubmitting}>
                                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    Confirm Cancellation
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <SecureDeleteFlow
                open={showSecureDelete}
                bookingId={booking.id}
                onClose={handleClose}
                onDeleted={() => {
                    onHardDeleted?.(booking.id);
                    onComplete?.({ action: 'deleted', bookingId: booking.id });
                }}
            />

            {showRescheduleInit && (
                <RescheduleInitiatedByDialog
                    booking={booking}
                    adminEmail={adminEmail}
                    onClose={handleClose}
                    onInitiated={(by) => {
                        setInitiatedBy(by);
                        setShowRescheduleInit(false);
                        setShowRescheduleWizard(true);
                    }}
                />
            )}

            {showRescheduleWizard && (
                <RescheduleDialog
                    open={showRescheduleWizard}
                    onClose={handleClose}
                    bookingId={booking.id}
                    adminMode
                    initiatedBy={initiatedBy}
                    adminEmail={adminEmail}
                    onSuccess={handleRescheduleComplete}
                />
            )}
        </>
    );
};
