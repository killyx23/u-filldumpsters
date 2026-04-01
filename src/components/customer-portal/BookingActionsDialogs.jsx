
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { format, parseISO, addDays, differenceInCalendarDays, isSameDay } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as ShadCalendar } from '@/components/ui/calendar';
import { generateTimeSlotOptions } from '@/components/admin/availability/time-helpers';

export const RescheduleDialog = ({ booking, isOpen, onOpenChange, onUpdate }) => {
    const [step, setStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [newDropOffDate, setNewDropOffDate] = useState(null);
    const [newPickupDate, setNewPickupDate] = useState(null);
    const [newDropOffTime, setNewDropOffTime] = useState(booking?.drop_off_time_slot || '');
    const [newPickupTime, setNewPickupTime] = useState(booking?.pickup_time_slot || '');
    const [availableDates, setAvailableDates] = useState([]);
    const [loadingAvailability, setLoadingAvailability] = useState(false);
    const [agreed, setAgreed] = useState(false);
    const [costBreakdown, setCostBreakdown] = useState(null);
    const [agreedToCharges, setAgreedToCharges] = useState(false);

    const timeSlots = useMemo(() => {
        const serviceId = booking?.plan?.id;
        if (!serviceId) return generateTimeSlotOptions(120);
        const intervalMap = { 1: 120, 2: 60, 3: 60, 4: 120 };
        return generateTimeSlotOptions(intervalMap[serviceId] || 120);
    }, [booking]);

    const calculatePrice = useCallback((plan, startDate, endDate) => {
        if (!plan || !startDate || !endDate) return 0;
        const isDelivery = booking.addons?.isDelivery;
        const dailyRate = plan.daily_rate || 100;
        const weeklyRate = plan.weekly_rate || 500;

        let duration = differenceInCalendarDays(endDate, startDate);
        if (duration < 1) duration = 1;

        let total = 0;
        if (plan.id === 2 && !isDelivery) { // Dump Trailer
            const weeks = Math.floor(duration / 7);
            const days = duration % 7;
            total = (weeks * weeklyRate) + (days * dailyRate);
        } else { // Dumpster
            total = plan.base_price || 0;
            if (duration > 7) {
                const extraDays = duration - 7;
                total += extraDays * 20;
            }
        }
        return total;
    }, [booking]);

    useEffect(() => {
        if (step === 4 && newDropOffDate && newPickupDate) {
            const newServicePrice = calculatePrice(booking.plan, newDropOffDate, newPickupDate);
            const originalServicePrice = calculatePrice(booking.plan, parseISO(booking.drop_off_date), parseISO(booking.pickup_date));
            
            const priceDifference = newServicePrice - originalServicePrice;
            const rescheduleFee = (booking.total_price || 0) * 0.10;
            const totalChange = priceDifference + rescheduleFee;
            const newTotalPrice = (booking.total_price || 0) + totalChange;

            setCostBreakdown({
                originalServicePrice,
                newServicePrice,
                priceDifference,
                rescheduleFee,
                totalChange,
                newTotalPrice,
            });
        }
    }, [step, newDropOffDate, newPickupDate, booking, calculatePrice]);

    const fetchAvailability = useCallback(async () => {
        if (!booking) return;
        setLoadingAvailability(true);
        try {
            const { data, error } = await supabase.functions.invoke('get-availability', {
                body: { 
                    serviceId: booking.plan.id, 
                    isDelivery: booking.addons.isDelivery,
                    startDate: format(new Date(), 'yyyy-MM-dd'),
                    endDate: format(addDays(new Date(), 365), 'yyyy-MM-dd'),
                },
            });
            if (error) throw error;
            if (data.error) throw new Error(data.error);
            
            const unavailableDates = data.availability 
                ? Object.entries(data.availability)
                    .filter(([, val]) => !val.available)
                    .map(([key]) => new Date(key + 'T00:00:00'))
                : [];

            setAvailableDates(unavailableDates);
        } catch (error) {
            toast({ title: "Failed to load availability", description: error.message, variant: "destructive" });
        } finally {
            setLoadingAvailability(false);
        }
    }, [booking]);

    useEffect(() => {
        if (isOpen && step === 2) {
            fetchAvailability();
        }
    }, [isOpen, step, fetchAvailability]);

    const resetAndClose = () => {
        setStep(1);
        setIsSubmitting(false);
        setNewDropOffDate(null);
        setNewPickupDate(null);
        setNewDropOffTime(booking?.drop_off_time_slot || '');
        setNewPickupTime(booking?.pickup_time_slot || '');
        setAgreed(false);
        setCostBreakdown(null);
        setAgreedToCharges(false);
        onOpenChange(false);
    };

    const handleSubmit = async () => {
        if (!costBreakdown) return;
        setIsSubmitting(true);
        try {
            const { error } = await supabase.functions.invoke('reschedule-booking', {
                body: {
                    bookingId: booking.id,
                    newDropOffDate: format(newDropOffDate, 'yyyy-MM-dd'),
                    newPickupDate: format(newPickupDate, 'yyyy-MM-dd'),
                    newDropOffTime: newDropOffTime,
                    newPickupTime: newPickupTime,
                    priceDifference: costBreakdown.totalChange,
                    rescheduleFee: costBreakdown.rescheduleFee,
                    newTotalPrice: costBreakdown.newTotalPrice,
                },
            });
            if (error) throw error;
            toast({ title: 'Reschedule Request Submitted!', description: 'Your request has been sent for admin approval.' });
            onUpdate();
            resetAndClose();
        } catch (e) {
            toast({ title: 'Rescheduling Failed', description: e.message, variant: 'destructive' });
            setIsSubmitting(false);
        }
    };

    const isNextDisabled = () => {
        if (step === 2 && !newDropOffDate) return true;
        if (step === 3 && !newPickupDate) return true;
        return false;
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-yellow-400 text-white max-w-lg">
                {step === 1 && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Reschedule Booking #{booking?.id}</DialogTitle>
                            <DialogDescription>Please review and agree to the terms before proceeding.</DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4 text-blue-100">
                            <p>You are about to request to reschedule your booking. Please be aware of the following:</p>
                            <ul className="list-disc list-inside space-y-2 text-sm">
                                <li>Your original dates will be released upon approval of the new dates.</li>
                                <li>New dates are subject to current availability.</li>
                                <li>A <span className="font-bold">10% reschedule fee</span> will be applied to your booking total.</li>
                                <li>Any difference in rental duration cost will be calculated and charged.</li>
                            </ul>
                            <div className="flex items-center space-x-2 mt-4 p-3 bg-gray-800 rounded-md">
                                <Checkbox id="agree-terms" checked={agreed} onCheckedChange={setAgreed} />
                                <Label htmlFor="agree-terms" className="text-sm font-medium leading-none cursor-pointer">
                                    I understand and agree to the rescheduling terms.
                                </Label>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={resetAndClose}>Cancel</Button>
                            <Button onClick={() => setStep(2)} disabled={!agreed}>Continue</Button>
                        </DialogFooter>
                    </>
                )}
                {step === 2 && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Select New Drop-off Date & Time</DialogTitle>
                        </DialogHeader>
                        <div className="py-4 flex flex-col md:flex-row gap-4 items-center justify-center">
                            {loadingAvailability ? <Loader2 className="h-8 w-8 animate-spin" /> : (
                                <ShadCalendar
                                    mode="single"
                                    selected={newDropOffDate}
                                    onSelect={setNewDropOffDate}
                                    disabled={date => date < new Date() || availableDates.some(disabledDate => isSameDay(disabledDate, date))}
                                    initialFocus
                                    className="bg-black/20 rounded-md border border-white/10"
                                />
                            )}
                            <div className="w-full md:w-48 space-y-2">
                                <Label>Drop-off Time</Label>
                                <Select value={newDropOffTime} onValueChange={setNewDropOffTime}>
                                    <SelectTrigger className="bg-gray-800 border-white/20"><SelectValue placeholder="Select time" /></SelectTrigger>
                                    <SelectContent className="bg-gray-800 border-white/20 text-white">
                                        {timeSlots.map(slot => <SelectItem key={slot.value} value={slot.value}>{slot.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                            <Button onClick={() => setStep(3)} disabled={isNextDisabled()}>Next: Select Pickup</Button>
                        </DialogFooter>
                    </>
                )}
                {step === 3 && (
                     <>
                        <DialogHeader>
                            <DialogTitle>Select New Pickup Date & Time</DialogTitle>
                        </DialogHeader>
                        <div className="py-4 flex flex-col md:flex-row gap-4 items-center justify-center">
                            {loadingAvailability ? <Loader2 className="h-8 w-8 animate-spin" /> : (
                                <ShadCalendar
                                    mode="single"
                                    selected={newPickupDate}
                                    onSelect={setNewPickupDate}
                                    disabled={date => isSameDay(date, newDropOffDate) || date < newDropOffDate || availableDates.some(disabledDate => isSameDay(disabledDate, date))}
                                    initialFocus
                                    className="bg-black/20 rounded-md border border-white/10"
                                />
                            )}
                             <div className="w-full md:w-48 space-y-2">
                                <Label>Pickup Time</Label>
                                <Select value={newPickupTime} onValueChange={setNewPickupTime}>
                                    <SelectTrigger className="bg-gray-800 border-white/20"><SelectValue placeholder="Select time" /></SelectTrigger>
                                    <SelectContent className="bg-gray-800 border-white/20 text-white">
                                        {timeSlots.map(slot => <SelectItem key={slot.value} value={slot.value}>{slot.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                            <Button onClick={() => setStep(4)} disabled={isNextDisabled()}>Next: Review Charges</Button>
                        </DialogFooter>
                    </>
                )}
                {step === 4 && costBreakdown && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Confirm New Charges</DialogTitle>
                            <DialogDescription>Please review the cost changes before submitting.</DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-3">
                            <div className="p-4 bg-gray-800 rounded-lg space-y-2 text-sm">
                                <p><strong>Original Dates:</strong> {format(parseISO(booking.drop_off_date), 'PPP')} - {format(parseISO(booking.pickup_date), 'PPP')}</p>
                                <p><strong>New Dates:</strong> {format(newDropOffDate, 'PPP')} - {format(newPickupDate, 'PPP')}</p>
                            </div>
                            <div className="p-4 bg-white/5 rounded-lg space-y-2 border border-white/10 text-sm">
                                <div className="flex justify-between items-center"><span>Original Booking Total:</span> <span>${(booking.total_price || 0).toFixed(2)}</span></div>
                                <div className="flex justify-between items-center"><span>Rental Duration Change:</span> <span className={costBreakdown.priceDifference >= 0 ? 'text-green-400' : 'text-red-400'}>${costBreakdown.priceDifference.toFixed(2)}</span></div>
                                <div className="flex justify-between items-center"><span>Reschedule Fee (10%):</span> <span>+ ${costBreakdown.rescheduleFee.toFixed(2)}</span></div>
                                <div className="flex justify-between items-center text-base font-bold border-t border-yellow-400/50 pt-2 mt-2">
                                    <span>Additional Charge:</span>
                                    <span className="text-yellow-400">${costBreakdown.totalChange.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center text-lg font-bold">
                                    <span>New Grand Total:</span>
                                    <span className="text-yellow-400">${costBreakdown.newTotalPrice.toFixed(2)}</span>
                                </div>
                            </div>
                            <div className="flex items-center space-x-2 mt-4 p-3 bg-gray-800 rounded-md">
                                <Checkbox id="agree-charges" checked={agreedToCharges} onCheckedChange={setAgreedToCharges} />
                                <Label htmlFor="agree-charges" className="text-sm font-medium leading-none cursor-pointer">
                                    I authorize a charge of ${costBreakdown.totalChange.toFixed(2)} and agree to the new total.
                                </Label>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
                            <Button onClick={handleSubmit} disabled={isSubmitting || !agreedToCharges}>
                                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Submit for Approval
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

export const CancelDialog = ({ booking, isOpen, onOpenChange, onUpdate }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const { error } = await supabase.functions.invoke('request-booking-change', {
                body: { bookingId: booking.id, reason: "Customer requested cancellation via portal." },
            });
            if (error) throw error;
            toast({ title: 'Cancellation Request Submitted', description: 'Your request has been sent for review.' });
            onUpdate();
            onOpenChange(false);
        } catch (e) {
            toast({ title: 'Cancellation Failed', description: e.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-red-500/50 text-white">
                <DialogHeader>
                    <DialogTitle className="text-red-400">Confirm Cancellation</DialogTitle>
                    <DialogDescription>Are you sure you want to request to cancel booking #{booking?.id}?</DialogDescription>
                </DialogHeader>
                <div className="py-4 text-blue-100 text-sm">
                    <p>A request will be sent to our team to cancel this booking. Please note that cancellation fees may apply according to our terms of service. Our team will review the request and process any applicable refunds.</p>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Go Back</Button>
                    <Button variant="destructive" onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Yes, Request Cancellation
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
