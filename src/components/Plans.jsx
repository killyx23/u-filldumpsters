import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { PlanCard } from '@/components/PlanCard';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, CheckCircle } from 'lucide-react';
import { formatISO, startOfDay, addDays } from 'date-fns';

export const Plans = ({ onSelectPlan }) => {
    const [plans, setPlans] = useState([]);
    const [availability, setAvailability] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchPlansAndAvailability = async () => {
            setLoading(true);

            const { data: plansData, error: plansError } = await supabase
                .from('services')
                .select('*')
                .in('id', [1, 2, 3])
                .order('id');
            
            if (plansError) {
                console.error("Error fetching plans:", plansError);
                setLoading(false);
                return;
            }
            
            setPlans(plansData);

            if (plansData.length === 0) {
                setLoading(false);
                return;
            }
            
            const todayStr = formatISO(startOfDay(new Date()), { representation: 'date' });
            
            // 1. Fetch explicit daily availability overrides for today from correct table
            const { data: dateSpecificAvailData } = await supabase
                .from('date_specific_availability')
                .select('service_id, is_available')
                .eq('date', todayStr);

            const todayAvailabilityMap = {};
            if (dateSpecificAvailData) {
                dateSpecificAvailData.forEach(item => {
                    todayAvailabilityMap[item.service_id] = item.is_available;
                });
            }

            // 2. Fetch general 30-day availability as fallback
            const startDate = todayStr;
            const endDate = formatISO(addDays(startOfDay(new Date()), 30), { representation: 'date' });
            
            const availabilityPromises = plansData.map(plan => 
                supabase.functions.invoke('get-availability', {
                    body: {
                        serviceId: plan.id,
                        startDate,
                        endDate,
                        isDelivery: plan.id === 2 ? false : undefined 
                    }
                })
            );
            
            const deliveryForPlan2Promise = supabase.functions.invoke('get-availability', {
                body: { serviceId: 2, startDate, endDate, isDelivery: true }
            });

            try {
                const results = await Promise.all([...availabilityPromises, deliveryForPlan2Promise]);
                const newAvailability = {};

                plansData.forEach((plan, index) => {
                    // Primary check: Is it explicitly marked closed today in admin?
                    if (todayAvailabilityMap[plan.id] === false) {
                        newAvailability[plan.id] = false;
                        return;
                    }

                    // Fallback check: Is it available at all in the next 30 days?
                    let isAnyDayAvailable = false;
                    const result = results[index];
                    
                    if (result.data?.availability) {
                        isAnyDayAvailable = Object.values(result.data.availability).some(day => day.available);
                    }
                    
                    if (plan.id === 2) {
                        const deliveryResult = results[results.length - 1];
                        if (deliveryResult.data?.availability) {
                            const isDeliveryAvailable = Object.values(deliveryResult.data.availability).some(day => day.available);
                            isAnyDayAvailable = isAnyDayAvailable || isDeliveryAvailable;
                        }
                    }

                    newAvailability[plan.id] = isAnyDayAvailable;
                });

                setAvailability(newAvailability);
            } catch (error) {
                console.error("Error fetching availability for plans:", error);
                // Fallback to just today's map if edge functions fail
                const fallbackAvail = {};
                plansData.forEach(p => fallbackAvail[p.id] = todayAvailabilityMap[p.id] !== false);
                setAvailability(fallbackAvail);
            } finally {
                setLoading(false);
            }
        };

        fetchPlansAndAvailability();
    }, []);

    const planHighlights = {
        1: { text: 'Our Most Popular Service', delay: 0.1 },
        2: { text: 'Incredible Value', delay: 0.2 },
        3: { text: 'Save Money and Time', delay: 0.3 },
    };

    const plansWithHighlights = plans.map((plan) => ({
        ...plan,
        highlight: planHighlights[plan.id],
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