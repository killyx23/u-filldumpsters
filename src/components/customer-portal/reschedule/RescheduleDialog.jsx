
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { format } from 'date-fns';
import { Loader2, ArrowRight, ArrowLeft, CheckCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

import { useRescheduleDataLoader } from '@/hooks/useRescheduleDataLoader';
import { RescheduleServiceSelectionSection } from './RescheduleServiceSelectionSection';
import { RescheduleDateTimeSelector } from './RescheduleDateTimeSelector';
import { RescheduleAddressVerification } from './RescheduleAddressVerification';
import { RescheduleAddonsSection } from './RescheduleAddonsSection';
import { ReschedulePricingBreakdownDisplay } from './ReschedulePricingBreakdownDisplay';
import { RescheduleAgreementsSection } from './RescheduleAgreementsSection';
import { RescheduleCommentsSection } from './RescheduleCommentsSection';
import { RescheduleRequestReview } from './RescheduleRequestReview';
import { calculateBookingCosts, calculateDays } from '@/utils/rescheduleCalculations';

const STEPS = [
    { id: 1, title: 'Service', nextLabel: 'Date & Time' },
    { id: 2, title: 'Date & Time', nextLabel: 'Address' },
    { id: 3, title: 'Address', nextLabel: 'Add-ons' },
    { id: 4, title: 'Add-ons', nextLabel: 'Pricing' },
    { id: 5, title: 'Pricing', nextLabel: 'Agreements' },
    { id: 6, title: 'Agreements', nextLabel: 'Comments' },
    { id: 7, title: 'Comments', nextLabel: 'Review' },
    { id: 8, title: 'Review', nextLabel: 'Confirm' }
];

export const RescheduleDialog = ({ booking: initialBooking, isOpen, onOpenChange, onSuccess }) => {
    const [step, setStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Core data loader
    const { data: loadedData, loading: isDataLoading } = useRescheduleDataLoader(isOpen ? initialBooking?.id : null);

    // Form State
    const [selectedService, setSelectedService] = useState(null);
    const [newDropOffDate, setNewDropOffDate] = useState(null);
    const [newPickupDate, setNewPickupDate] = useState(null);
    const [newDropOffTime, setNewDropOffTime] = useState('');
    const [newPickupTime, setNewPickupTime] = useState('');
    const [address, setAddress] = useState('');
    const [distanceMiles, setDistanceMiles] = useState(0);
    const [distanceInfoError, setDistanceInfoError] = useState(false);
    const [selectedAddonsList, setSelectedAddonsList] = useState([]);
    const [agreements, setAgreements] = useState({ terms: false, charges: false, release: false });
    const [comments, setComments] = useState('');
    const [newCosts, setNewCosts] = useState(null);

    useEffect(() => {
        if (loadedData && isOpen && step === 1) {
            setSelectedService(loadedData.originalService);
            setNewDropOffTime(loadedData.originalBooking.drop_off_time_slot || '08:00');
            setNewPickupTime(loadedData.originalBooking.pickup_time_slot || '17:00');
            setAddress(loadedData.originalBooking.delivery_address?.formatted_address || `${loadedData.originalBooking.street}, ${loadedData.originalBooking.city}, ${loadedData.originalBooking.state} ${loadedData.originalBooking.zip}`);
            setDistanceMiles(loadedData.distanceMiles);
            setSelectedAddonsList(loadedData.originalAddonsList);
        }
    }, [loadedData, isOpen, step]);

    // Recalculate costs whenever key variables change
    useEffect(() => {
        if (selectedService && newDropOffDate && newPickupDate) {
            const days = calculateDays(newDropOffDate, newPickupDate);
            const costs = calculateBookingCosts(selectedService, days, selectedAddonsList, distanceMiles);
            setNewCosts(costs);
        }
    }, [selectedService, newDropOffDate, newPickupDate, selectedAddonsList, distanceMiles]);

    const handleNext = () => setStep(prev => Math.min(prev + 1, STEPS.length));
    const handleBack = () => setStep(prev => Math.max(prev - 1, 1));

    const isNextDisabled = () => {
        if (step === 1 && !selectedService) return true;
        if (step === 2 && (!newDropOffDate || !newPickupDate || !newDropOffTime || !newPickupTime)) return true;
        if (step === 3 && distanceInfoError) return true;
        if (step === 6 && (!agreements.terms || !agreements.charges || !agreements.release)) return true;
        return false;
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const originalAppt = loadedData.originalBooking.drop_off_date + (loadedData.originalBooking.drop_off_time_slot ? `T${loadedData.originalBooking.drop_off_time_slot}` : 'T00:00:00');
            const newAppt = format(newDropOffDate, 'yyyy-MM-dd') + `T${newDropOffTime}`;
            const diffVal = newCosts.total - loadedData.originalCosts.total;

            const { error: historyError } = await supabase.from('reschedule_history_logs').insert({
                booking_id: loadedData.originalBooking.id,
                original_appointment_time: originalAppt,
                reschedule_request_time: new Date().toISOString(),
                new_appointment_time: newAppt,
                request_status: 'pending',
                fee_applied: false,
                fee_amount: 0,
                original_total: loadedData.originalCosts.total,
                new_total: newCosts.total,
                original_service_id: loadedData.originalService.id,
                new_service_id: selectedService?.id,
                cancellation_reason: comments,
                new_drop_off_date: format(newDropOffDate, 'yyyy-MM-dd'),
                new_pickup_date: format(newPickupDate, 'yyyy-MM-dd'),
                new_drop_off_time: newDropOffTime,
                new_pickup_time: newPickupTime
            });

            if (historyError) throw historyError;

            const { error: updateError } = await supabase.from('bookings').update({
                status: 'reschedule_pending'
            }).eq('id', loadedData.originalBooking.id);

            if (updateError) throw updateError;

            if (comments) {
                await supabase.from('customer_notes').insert({
                    customer_id: loadedData.originalBooking.customers.id,
                    booking_id: loadedData.originalBooking.id,
                    source: 'Reschedule Request',
                    content: `Customer requested reschedule. Comments: ${comments}`,
                    author_type: 'customer'
                });
            }

            toast({ title: 'Success', description: 'Your high-priority request has been submitted successfully.' });
            if (onSuccess) onSuccess();
            onOpenChange(false);
            
            setTimeout(() => setStep(1), 500);
        } catch (error) {
            console.error("Submission error:", error);
            toast({ title: 'Error Submitting Request', description: error.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isOpen && isDataLoading) {
        return (
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md bg-gray-950 border-gray-800">
                    <div className="flex flex-col items-center justify-center p-12 space-y-6">
                        <Loader2 className="w-12 h-12 animate-spin text-gold" />
                        <p className="text-gray-300 font-bold text-lg tracking-wide">Initializing secure context...</p>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    if (!loadedData) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            if (!isSubmitting) onOpenChange(open);
        }}>
            <DialogContent className="reschedule-dialog-wide max-w-7xl w-[95vw] md:w-[90vw] lg:w-[85vw] max-h-[95vh] h-[90vh] flex flex-col p-0 overflow-hidden bg-gray-950 border-gray-800">
                <div className="flex-shrink-0 px-8 py-6 bg-gray-950 border-b border-gray-800 flex flex-col gap-6 z-10 shadow-sm">
                    <DialogTitle className="text-3xl font-extrabold text-white flex justify-between items-center m-0 p-0 tracking-tight">
                        <span>Modify Reservation <span className="text-gold/80 text-xl ml-3">#{loadedData.originalBooking?.id}</span></span>
                        <span className="text-xs font-black text-gray-950 bg-gold px-5 py-2 rounded-full uppercase tracking-widest shadow-[0_0_15px_hsla(var(--gold),0.4)]">Step {step}/{STEPS.length}</span>
                    </DialogTitle>
                    <div className="flex gap-3 w-full">
                        {STEPS.map(s => (
                            <div key={s.id} className="flex flex-col flex-1">
                                <div className={`h-2 w-full rounded-full transition-all duration-500 ${step >= s.id ? 'bg-gold shadow-[0_0_10px_hsla(var(--gold),0.6)]' : 'bg-gray-800'}`} />
                                <span className={`text-[10px] mt-2.5 font-bold uppercase tracking-widest text-center transition-colors duration-500 hidden md:block ${step >= s.id ? 'text-gold-light' : 'text-gray-600'}`}>{s.title}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="reschedule-content-area flex-1 overflow-y-auto p-6 md:p-10 bg-gray-950">
                    {step === 1 && <RescheduleServiceSelectionSection currentServiceId={loadedData.originalService.id} selectedService={selectedService} onSelectService={setSelectedService} availableServices={loadedData.availableServices} />}
                    {step === 2 && <RescheduleDateTimeSelector booking={loadedData.originalBooking} availableDates={loadedData.availableDates} newDropOffDate={newDropOffDate} setNewDropOffDate={setNewDropOffDate} newPickupDate={newPickupDate} setNewPickupDate={setNewPickupDate} newDropOffTime={newDropOffTime} setNewDropOffTime={setNewDropOffTime} newPickupTime={newPickupTime} setNewPickupTime={setNewPickupTime} />}
                    {step === 3 && <RescheduleAddressVerification booking={loadedData.originalBooking} newService={selectedService} onAddressUpdated={(addr, info) => { setAddress(addr); if(info) { setDistanceMiles(info.distance); setDistanceInfoError(info.error); } }} />}
                    {step === 4 && <RescheduleAddonsSection originalAddonsList={loadedData.originalAddonsList} selectedAddonsList={selectedAddonsList} setSelectedAddonsList={setSelectedAddonsList} />}
                    {step === 5 && <ReschedulePricingBreakdownDisplay originalService={loadedData.originalService} originalAddonsList={loadedData.originalAddonsList} originalCosts={loadedData.originalCosts} newService={selectedService} newAddonsList={selectedAddonsList} newDropOffDate={newDropOffDate} newPickupDate={newPickupDate} distanceMiles={distanceMiles} />}
                    {step === 6 && <RescheduleAgreementsSection agreements={agreements} setAgreements={setAgreements} booking={loadedData.originalBooking} />}
                    {step === 7 && <RescheduleCommentsSection comments={comments} setComments={setComments} />}
                    {step === 8 && <RescheduleRequestReview originalBooking={loadedData.originalBooking} originalService={loadedData.originalService} originalCosts={loadedData.originalCosts} newService={selectedService} newAddonsList={selectedAddonsList} newCosts={newCosts} newDropOffDate={newDropOffDate} newPickupDate={newPickupDate} newDropOffTime={newDropOffTime} newPickupTime={newPickupTime} address={address} comments={comments} agreements={agreements} />}
                </div>

                <div className="flex-shrink-0 flex gap-4 justify-between items-center px-8 py-6 bg-gray-950 border-t border-gray-800 z-10 shadow-[0_-10px_30px_rgba(0,0,0,0.4)]">
                    <Button 
                        variant="outline" 
                        onClick={handleBack} 
                        disabled={step === 1 || isSubmitting} 
                        className="w-full md:w-auto border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white px-8 py-6 h-auto text-base font-bold rounded-xl"
                    >
                        <ArrowLeft className="w-5 h-5 mr-2" /> Back
                    </Button>
                    
                    {step < STEPS.length ? (
                        <Button 
                            onClick={handleNext} 
                            disabled={isNextDisabled()} 
                            className="w-full md:w-auto bg-gold hover:bg-gold-light text-gray-950 shadow-[0_0_20px_hsla(var(--gold),0.3)] transition-all active:scale-95 px-10 py-6 h-auto text-base font-extrabold rounded-xl disabled:opacity-50 disabled:shadow-none"
                        >
                            Next: {STEPS[step].title} <ArrowRight className="w-5 h-5 ml-2" />
                        </Button>
                    ) : (
                        <Button 
                            onClick={handleSubmit} 
                            disabled={isSubmitting} 
                            className="w-full md:w-auto bg-green-500 hover:bg-green-400 text-green-950 font-extrabold shadow-[0_0_30px_rgba(34,197,94,0.4)] transition-all active:scale-95 px-12 py-6 h-auto text-lg rounded-xl disabled:opacity-50 disabled:shadow-none"
                        >
                            {isSubmitting ? (
                                <><Loader2 className="mr-3 h-6 w-6 animate-spin" /> Authorizing...</>
                            ) : (
                                <><CheckCircle className="w-6 h-6 mr-3" /> Submit Authorized Request</>
                            )}
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
