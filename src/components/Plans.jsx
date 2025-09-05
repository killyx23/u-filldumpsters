import React, { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PlanCard } from '@/components/PlanCard';
import { BookingForm } from '@/components/BookingForm';
import { AddonsForm } from '@/components/AddonsForm';
import { UserAgreement } from '@/components/UserAgreement';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';
import { dumpsterPlans as staticPlans } from '@/data/plans';

const BookingStep = ({ children, onBack }) => {
    return (
        <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -300 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            className="w-full"
        >
            {children}
        </motion.div>
    );
};

export const Plans = ({ onBookingSubmit }) => {
    const [step, setStep] = useState(0);
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [bookingData, setBookingData] = useState({ name: '', email: '', phone: '', street: '', city: 'Saratoga Springs', state: 'UT', zip: '', dropOffDate: null, pickupDate: null, dropOffTimeSlot: '', pickupTimeSlot: '' });
    const [showAgreement, setShowAgreement] = useState(false);
    const [agreementAccepted, setAgreementAccepted] = useState(false);
    const [serviceAvailability, setServiceAvailability] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchAvailability = async () => {
            setLoading(true);
            const { data, error } = await supabase.from('service_availability').select('*');
            if (error) {
                toast({ title: 'Error fetching service availability.', description: error.message, variant: 'destructive' });
            } else {
                setServiceAvailability(data || []);
            }
            setLoading(false);
        };
        fetchAvailability();
    }, []);

    const servicesTemporarilyUnavailable = useMemo(() => {
        const availabilityByService = serviceAvailability.reduce((acc, curr) => {
            if (!acc[curr.service_id]) {
                acc[curr.service_id] = [];
            }
            acc[curr.service_id].push(curr);
            return acc;
        }, {});

        const unavailableServices = new Set();
        Object.keys(availabilityByService).forEach(serviceId => {
            const rules = availabilityByService[serviceId];
            const isAlwaysClosed = rules.length >= 7 && rules.every(day => !day.is_available);
            if (isAlwaysClosed) {
                unavailableServices.add(Number(serviceId));
            }
        });
        return unavailableServices;
    }, [serviceAvailability]);

    const handleSelectPlan = (plan) => {
        setSelectedPlan(plan);
        setStep(1);
    };

    const handleFormBack = () => setStep(0);
    const handleAddonsBack = () => setStep(1);

    const handleFormSubmit = (price, addressSkipped, distanceInfo) => {
        setBookingData(prev => ({ ...prev, price, addons: { ...prev.addons, addressVerificationSkipped: addressSkipped, distanceInfo } }));
        setStep(2);
    };

    const handleAddonsSubmit = (finalData) => {
        setBookingData(prev => ({ ...prev, ...finalData }));
        onBookingSubmit({ ...bookingData, ...finalData });
    };

    const handleShowAgreement = () => setShowAgreement(true);
    const handleAcceptAgreement = () => {
        setAgreementAccepted(true);
        setShowAgreement(false);
    };
    const handleDeclineAgreement = () => {
        setAgreementAccepted(false);
        setShowAgreement(false);
    };

    return (
        <section id="booking" className="py-20 relative">
            <AnimatePresence mode="wait">
                {step === 0 && (
                    <motion.div
                        key="step1"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <div className="text-center mb-12">
                            <h2 className="text-5xl font-extrabold text-white">Choose Your Rental Plan</h2>
                            <p className="text-lg text-blue-200 mt-4 max-w-2xl mx-auto">Select the perfect option for your project needs. All plans come with our guarantee of timely service and support.</p>
                        </div>
                        {loading ? (
                            <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 text-yellow-400 animate-spin" /></div>
                        ) : (
                            <div className="container mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 px-4">
                                {staticPlans.map(plan => (
                                    <PlanCard 
                                        key={plan.id} 
                                        plan={plan} 
                                        onSelect={handleSelectPlan}
                                        isTemporarilyUnavailable={servicesTemporarilyUnavailable.has(plan.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </motion.div>
                )}
                {step === 1 && selectedPlan && (
                    <BookingStep key="step2" onBack={handleFormBack}>
                        <BookingForm
                            plan={selectedPlan}
                            bookingData={bookingData}
                            setBookingData={setBookingData}
                            onSubmit={handleFormSubmit}
                            onBack={handleFormBack}
                            onShowAgreement={handleShowAgreement}
                            agreementAccepted={agreementAccepted}
                        />
                    </BookingStep>
                )}
                {step === 2 && selectedPlan && (
                    <BookingStep key="step3" onBack={handleAddonsBack}>
                        <AddonsForm
                            plan={selectedPlan}
                            bookingData={bookingData}
                            onBack={handleAddonsBack}
                            onSubmit={handleAddonsSubmit}
                        />
                    </BookingStep>
                )}
            </AnimatePresence>
            {showAgreement && (
                <UserAgreement onAccept={handleAcceptAgreement} onDecline={handleDeclineAgreement} />
            )}
        </section>
    );
};