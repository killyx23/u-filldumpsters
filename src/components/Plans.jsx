import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { PlanCard } from '@/components/PlanCard';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, CheckCircle } from 'lucide-react';
import { eachDayOfInterval, formatISO, startOfDay, addDays } from 'date-fns';

export const Plans = ({ plans, onSelectPlan }) => {
    const [availability, setAvailability] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchAllAvailability = async () => {
            const startDate = formatISO(startOfDay(new Date()), { representation: 'date' });
            const endDate = formatISO(addDays(startOfDay(new Date()), 30), { representation: 'date' });
            
            const availabilityPromises = plans.map(plan => 
                supabase.functions.invoke('get-availability', {
                    body: {
                        serviceId: plan.id,
                        startDate,
                        endDate,
                        isDelivery: plan.id === 2 // Check both self-pickup and delivery for plan 2
                    }
                })
            );
            
            const deliveryForPlan2Promise = supabase.functions.invoke('get-availability', {
                body: { serviceId: 2, startDate, endDate, isDelivery: true }
            });

            try {
                const results = await Promise.all([...availabilityPromises, deliveryForPlan2Promise]);
                const newAvailability = {};

                results.slice(0, plans.length).forEach((result, index) => {
                    const planId = plans[index].id;
                    if (result.data?.availability) {
                        const isAnyDayAvailable = Object.values(result.data.availability).some(day => day.available);
                        newAvailability[planId] = isAnyDayAvailable;
                    } else {
                        newAvailability[planId] = false;
                    }
                });
                
                // Special handling for plan 2 delivery
                const deliveryResult = results[results.length - 1];
                if (deliveryResult.data?.availability) {
                    const isDeliveryAvailable = Object.values(deliveryResult.data.availability).some(day => day.available);
                    // If either self-service OR delivery is available, we consider plan 2 available.
                    // The "Temporarily unavailable" will only show if BOTH are unavailable.
                     newAvailability[2] = newAvailability[2] || isDeliveryAvailable;
                }

                setAvailability(newAvailability);
            } catch (error) {
                console.error("Error fetching availability for plans:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchAllAvailability();
    }, [plans]);

    const planHighlights = {
        1: { text: 'Our Most Popular Service', delay: 0.2 },
        2: { text: 'Incredible Value', delay: 0.1 },
        3: { text: 'Save Money and Time', delay: 0 },
    };

    const plansWithHighlights = plans.map((plan) => ({
        ...plan,
        highlight: planHighlights[plan.id]
    }));
    
    if (loading) {
      return (
        <div className="flex justify-center items-center h-96">
            <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
        </div>
      );
    }

    const valueProps = [
        "Simple and Fast Online Scheduling",
        "Up-Front and Competitive Pricing",
        "Professional Service"
    ];

    return (
        <section className="py-20 px-4">
            <div className="container mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="text-center mb-12"
                >
                    <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-4 tracking-tight" style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>Choose Your Service</h2>
                    <p className="text-xl text-blue-200 max-w-2xl mx-auto">Select the perfect solution for your project, backed by reliable service.</p>
                </motion.div>

                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                    className="flex flex-wrap justify-center items-center gap-x-8 gap-y-4 mb-24"
                >
                    {valueProps.map((prop, index) => (
                        <div key={index} className="flex items-center text-lg text-green-300">
                            <CheckCircle className="h-6 w-6 mr-2 text-green-400" />
                            <span className="font-semibold">{prop}</span>
                        </div>
                    ))}
                </motion.div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-16">
                    {plansWithHighlights.map((plan) => {
                         const isTemporarilyUnavailable = availability[plan.id] === false;
                         return (
                            <PlanCard
                                key={plan.id}
                                plan={plan}
                                onSelect={onSelectPlan}
                                isTemporarilyUnavailable={isTemporarilyUnavailable}
                            />
                         );
                    })}
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 50 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.5 }}
                    className="text-center mt-20 max-w-3xl mx-auto"
                >
                    <h3 className="text-2xl font-bold text-yellow-400 mb-3">U-Fill Dumpsters LLC</h3>
                    <p className="text-lg text-blue-200 leading-relaxed">
                        Your trusted partner for waste management solutions. We're committed to providing fast, reliable, and affordable services to help you get the job done right.
                    </p>
                </motion.div>
            </div>
        </section>
    );
};