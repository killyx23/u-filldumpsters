
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { format, parseISO, addDays, differenceInCalendarDays, isSameDay } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Calendar as ShadCalendar } from '@/components/ui/calendar';
import { formatRescheduleMessage } from '@/utils/rescheduleCalculations';
import { useRescheduleCalculations } from '@/hooks/useRescheduleCalculations';
import { useAvailableTimeSlots } from '@/hooks/useAvailableTimeSlots';
import { TimePickerDropdown } from '@/components/TimePickerDropdown';
import { RescheduleServiceSelector } from './RescheduleServiceSelector';
import { RescheduleReviewSummary } from './RescheduleReviewSummary';
import { RescheduleTermsAndConditions } from './RescheduleTermsAndConditions';
import { getServiceTerminology } from '@/utils/RescheduleServiceTerminology';

export const RescheduleDialog = ({ booking, isOpen, onOpenChange, onUpdate }) => {
    const [step, setStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // State for selected service (Task 1 & 2)
    const [selectedPlanId, setSelectedPlanId] = useState(booking?.plan?.id);
    const [selectedServiceData, setSelectedServiceData] = useState(booking?.plan);
    const [availableServices, setAvailableServices] = useState([]);
    const [loadingServices, setLoadingServices] = useState(false);

    const [newDropOffDate, setNewDropOffDate] = useState(null);
    const [newPickupDate, setNewPickupDate] = useState(null);
    const [newDropOffTime, setNewDropOffTime] = useState(booking?.drop_off_time_slot || '');
    const [newPickupTime, setNewPickupTime] = useState(booking?.pickup_time_slot || '');
    const [availableDates, setAvailableDates] = useState([]);
    const [loadingAvailability, setLoadingAvailability] = useState(false);
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [costBreakdown, setCostBreakdown] = useState(null);

    const { getRescheduleDetails } = useRescheduleCalculations();

    // Use current selection to determine terminology
    const isDelivery = selectedPlanId === 2 ? booking?.addons?.isDelivery : (selectedPlanId === 1 || selectedPlanId === 4);
    const terminology = getServiceTerminology(selectedPlanId, isDelivery);

    const dropOffTimeType = selectedPlanId === 1 ? 'delivery' : (selectedPlanId === 2 && !isDelivery ? 'pickup' : (selectedPlanId === 2 && isDelivery ? 'delivery' : (selectedPlanId === 3 ? 'delivery' : 'delivery')));
    const pickupTimeType = selectedPlanId === 1 ? 'pickup' : (selectedPlanId === 2 && !isDelivery ? 'return' : (selectedPlanId === 2 && isDelivery ? 'pickup' : 'pickup'));

    const { timeSlots: dropOffSlots, isLoading: dropOffLoading } = useAvailableTimeSlots(selectedPlanId, newDropOffDate, dropOffTimeType);
    const { timeSlots: pickupSlots, isLoading: pickupLoading } = useAvailableTimeSlots(selectedPlanId, newPickupDate, pickupTimeType);

    // Fetch available services when dialog opens
    useEffect(() => {
        if (isOpen && step === 1) {
            const fetchServices = async () => {
                setLoadingServices(true);
                const { data, error } = await supabase.from('services').select('*').order('id');
                if (!error && data) {
                    setAvailableServices(data);
                    // Ensure we have full data for currently selected plan
                    const current = data.find(s => s.id === (selectedPlanId || booking?.plan?.id));
                    if (current) setSelectedServiceData(current);
                }
                setLoadingServices(false);
            };
            fetchServices();
            
            // Reset dates if service changed
            if (selectedPlanId !== booking?.plan?.id) {
                setNewDropOffDate(null);
                setNewPickupDate(null);
                setNewDropOffTime('');
                setNewPickupTime('');
            }
        }
    }, [isOpen, step, selectedPlanId, booking?.plan?.id]);

    const calculatePriceDifference = useCallback((plan, startDate, endDate) => {
        if (!plan || !startDate || !endDate) return 0;
        const dailyRate = plan.daily_rate || 100;
        const weeklyRate = plan.weekly_rate || 500;

        let newDuration = differenceInCalendarDays(endDate, startDate);
        if (newDuration < 1) newDuration = 1;
        
        let oldDuration = differenceInCalendarDays(parseISO(booking.pickup_date), parseISO(booking.drop_off_date));
        if (oldDuration < 1) oldDuration = 1;

        let originalServicePrice = booking.total_price || 0; // Use actual total price paid
        let newServicePrice = 0;

        if (plan.id === 2 && !isDelivery) {
            newServicePrice = (Math.floor(newDuration / 7) * weeklyRate) + ((newDuration % 7) * dailyRate);
        } else {
            newServicePrice = plan.base_price || 0;
            if (newDuration > 7) newServicePrice += (newDuration - 7) * 20;
        }
        
        // Add delivery fee if applicable
        if (plan.delivery_fee) newServicePrice += Number(plan.delivery_fee);
        
        return newServicePrice - originalServicePrice;
    }, [booking, isDelivery]);

    useEffect(() => {
        if (step === 3 && newDropOffDate && newPickupDate && selectedServiceData) {
            const priceDifference = calculatePriceDifference(selectedServiceData, newDropOffDate, newPickupDate);
            
            const details = getRescheduleDetails(booking, newDropOffDate, newDropOffTime, priceDifference);
            
            setCostBreakdown({
                priceDifference,
                rescheduleFee: details.feeAmount,
                feeApplies: details.feeApplies,
                totalChange: details.totalChange,
                newTotalPrice: details.newTotal,
                historyEntry: details.rescheduleHistoryEntry,
                originalPrice: booking.total_price || 0,
                newServicePrice: (booking.total_price || 0) + priceDifference
            });
        }
    }, [step, newDropOffDate, newPickupDate, newDropOffTime, selectedServiceData, booking, calculatePriceDifference, getRescheduleDetails]);

    const fetchAvailability = useCallback(async () => {
        if (!selectedPlanId) return;
        setLoadingAvailability(true);
        try {
            const { data, error } = await supabase.functions.invoke('get-availability', {
                body: { 
                    serviceId: selectedPlanId, 
                    isDelivery: isDelivery,
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
    }, [selectedPlanId, isDelivery]);

    useEffect(() => {
        if (isOpen && step === 2) fetchAvailability();
    }, [isOpen, step, fetchAvailability]);

    const resetAndClose = () => {
        setStep(1);
        setIsSubmitting(false);
        setSelectedPlanId(booking?.plan?.id);
        setSelectedServiceData(booking?.plan);
        setNewDropOffDate(null);
        setNewPickupDate(null);
        setNewDropOffTime(booking?.drop_off_time_slot || '');
        setNewPickupTime(booking?.pickup_time_slot || '');
        setAgreedToTerms(false);
        setCostBreakdown(null);
        onOpenChange(false);
    };

    const handleServiceSelect = (serviceId) => {
        setSelectedPlanId(serviceId);
        const service = availableServices.find(s => s.id === serviceId);
        if (service) setSelectedServiceData(service);
    };

    const handleSubmit = async () => {
        if (!costBreakdown) return;
        setIsSubmitting(true);
        try {
            if (costBreakdown.totalChange > 0) {
                const { data: paymentData, error: paymentError } = await supabase.functions.invoke('process-reschedule-fee', {
                    body: {
                        bookingId: booking.id,
                        customerId: booking.customers?.stripe_customer_id,
                        feeAmount: costBreakdown.totalChange,
                        paymentMethodId: null
                    }
                });
                if (paymentError) throw paymentError;
                if (!paymentData?.success) throw new Error(paymentData?.error || 'Payment processing failed');
            }

            // Update booking with new plan if changed
            const updatePayload = {
                bookingId: booking.id,
                newDropOffDate: format(newDropOffDate, 'yyyy-MM-dd'),
                newPickupDate: format(newPickupDate, 'yyyy-MM-dd'),
                newDropOffTime: newDropOffTime,
                newPickupTime: newPickupTime,
                priceDifference: costBreakdown.totalChange,
                rescheduleFee: costBreakdown.rescheduleFee,
                newTotalPrice: costBreakdown.newTotalPrice,
                historyEntry: costBreakdown.historyEntry
            };

            if (selectedPlanId !== booking?.plan?.id) {
                // We'd ideally pass the new plan JSON here if backend supported it easily
                // For now, we mainly update dates and rely on notes
            }

            const { error: updateError } = await supabase.functions.invoke('reschedule-booking', {
                body: updatePayload,
            });
            if (updateError) throw updateError;

            // Log to customer notes for audit trail
            const noteContent = `**Booking Rescheduled & Terms Accepted**\n` +
                `Original: ${booking.plan?.name} (${format(parseISO(booking.drop_off_date), 'MMM d, yyyy')} - ${format(parseISO(booking.pickup_date), 'MMM d, yyyy')})\n` +
                `New: ${selectedServiceData?.name} (${format(newDropOffDate, 'MMM d, yyyy')} - ${format(newPickupDate, 'MMM d, yyyy')})\n` +
                `Original Total: $${(booking.total_price || 0).toFixed(2)}\n` +
                `New Total: $${costBreakdown.newTotalPrice.toFixed(2)}\n` +
                `Terms: Customer acknowledged insurance implications and safety requirements for service change.`;
                
            await supabase.from('customer_notes').insert({
                customer_id: booking.customer_id,
                booking_id: booking.id,
                source: 'System Audit',
                content: noteContent,
                author_type: 'system',
                is_read: false
            });

            await supabase.functions.invoke('send-reschedule-confirmation-email', {
                body: {
                    bookingId: booking.id,
                    customerId: booking.customer_id,
                    originalAppointmentTime: costBreakdown.historyEntry.original_appointment_time,
                    newAppointmentTime: costBreakdown.historyEntry.new_appointment_time,
                    feeApplies: costBreakdown.feeApplies,
                    feeAmount: costBreakdown.rescheduleFee,
                    newTotal: costBreakdown.newTotalPrice
                }
            });

            toast({ title: 'Rescheduled Successfully!', description: 'Your appointment has been updated.' });
            onUpdate();
            resetAndClose();
        } catch (e) {
            toast({ title: 'Rescheduling Failed', description: e.message, variant: 'destructive' });
            setIsSubmitting(false);
        }
    };

    const isNextDisabled = () => {
        if (step === 2 && (!newDropOffDate || !newDropOffTime || !newPickupDate || !newPickupTime)) return true;
        if (step === 4 && !agreedToTerms) return true;
        return false;
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-yellow-400 text-white max-w-2xl w-full">
                {/* Progress Indicator */}
                <div className="mb-6">
                    <div className="flex justify-between items-center px-4">
                        {[1, 2, 3, 4].map((s) => (
                            <div key={s} className="flex flex-col items-center">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step === s ? 'bg-yellow-500 text-black' : step > s ? 'bg-green-500 text-black' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
                                    {step > s ? '✓' : s}
                                </div>
                                <span className={`text-[10px] mt-1 ${step >= s ? 'text-gray-300' : 'text-gray-600'}`}>
                                    {s === 1 ? 'Service' : s === 2 ? 'Dates' : s === 3 ? 'Review' : 'Confirm'}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="relative mt-2 h-1 bg-gray-800 rounded-full mx-8">
                        <div className="absolute top-0 left-0 h-full bg-yellow-500 rounded-full transition-all duration-300" style={{ width: `${((step - 1) / 3) * 100}%` }}></div>
                    </div>
                </div>

                {step === 1 && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Step 1: Confirm or Change Service</DialogTitle>
                            <DialogDescription>You can keep your current service or switch to a different option.</DialogDescription>
                        </DialogHeader>
                        <div className="py-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                            {loadingServices ? (
                                <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-yellow-500" /></div>
                            ) : (
                                <RescheduleServiceSelector 
                                    services={availableServices} 
                                    selectedPlanId={selectedPlanId} 
                                    onSelect={handleServiceSelect} 
                                    originalPlanId={booking?.plan?.id}
                                />
                            )}
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={resetAndClose}>Cancel</Button>
                            <Button onClick={() => setStep(2)}>Next: Dates & Times</Button>
                        </DialogFooter>
                    </>
                )}

                {step === 2 && (
                    <>
                        <DialogHeader>
                            <DialogTitle>{terminology.dialogTitle}</DialogTitle>
                            <DialogDescription>Select new dates for {selectedServiceData?.name}</DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-6">
                            <div className="flex flex-col md:flex-row gap-6">
                                <div className="flex-1 space-y-4">
                                    <Label className="text-yellow-400 font-semibold">{terminology.dropoffLabel}</Label>
                                    <div className="bg-black/20 p-4 rounded-xl border border-white/10">
                                        {loadingAvailability ? <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div> : (
                                            <ShadCalendar
                                                mode="single"
                                                selected={newDropOffDate}
                                                onSelect={(d) => { setNewDropOffDate(d); if(newPickupDate && d > newPickupDate) setNewPickupDate(null); }}
                                                disabled={date => date < new Date() || availableDates.some(disabledDate => isSameDay(disabledDate, date))}
                                                initialFocus
                                                className="bg-transparent"
                                            />
                                        )}
                                        <div className="mt-4">
                                            <Label className="text-xs text-gray-400 mb-1 block">Select Time</Label>
                                            <TimePickerDropdown 
                                                selectedTime={newDropOffTime} 
                                                onTimeChange={setNewDropOffTime} 
                                                timeSlots={dropOffSlots} 
                                                isLoading={dropOffLoading || loadingAvailability} 
                                                disabled={!newDropOffDate} 
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-1 space-y-4">
                                    <Label className="text-yellow-400 font-semibold">{terminology.pickupLabel}</Label>
                                    <div className="bg-black/20 p-4 rounded-xl border border-white/10">
                                        {loadingAvailability ? <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div> : (
                                            <ShadCalendar
                                                mode="single"
                                                selected={newPickupDate}
                                                onSelect={setNewPickupDate}
                                                disabled={date => !newDropOffDate || date < newDropOffDate || availableDates.some(disabledDate => isSameDay(disabledDate, date))}
                                                className="bg-transparent"
                                            />
                                        )}
                                        <div className="mt-4">
                                            <Label className="text-xs text-gray-400 mb-1 block">Select Time</Label>
                                            <TimePickerDropdown 
                                                selectedTime={newPickupTime} 
                                                onTimeChange={setNewPickupTime} 
                                                timeSlots={pickupSlots} 
                                                isLoading={pickupLoading || loadingAvailability} 
                                                disabled={!newPickupDate} 
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <DialogFooter className="mt-4 border-t border-gray-800 pt-4">
                            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                            <Button onClick={() => setStep(3)} disabled={isNextDisabled()}>Next: Review Costs</Button>
                        </DialogFooter>
                    </>
                )}

                {step === 3 && costBreakdown && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Step 3: Review Cost Adjustments</DialogTitle>
                            <DialogDescription>Review changes in pricing based on your new selections.</DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <RescheduleReviewSummary 
                                booking={booking}
                                newDropOffDate={newDropOffDate}
                                newPickupDate={newPickupDate}
                                newDropOffTime={newDropOffTime}
                                newPickupTime={newPickupTime}
                                selectedServiceData={selectedServiceData}
                                costBreakdown={costBreakdown}
                                terminology={terminology}
                            />
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                            <Button onClick={() => setStep(4)}>Next: Confirm Terms</Button>
                        </DialogFooter>
                    </>
                )}

                {step === 4 && (
                    <>
                        <DialogHeader>
                            <DialogTitle>Step 4: Terms & Conditions</DialogTitle>
                            <DialogDescription>Please review and accept the terms for this change.</DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <RescheduleTermsAndConditions 
                                serviceId={selectedPlanId}
                                agreed={agreedToTerms}
                                onAgreedChange={setAgreedToTerms}
                            />
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
                            <Button onClick={handleSubmit} disabled={isSubmitting || !agreedToTerms} className="bg-yellow-500 text-black hover:bg-yellow-600 font-bold">
                                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Complete Reschedule
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
