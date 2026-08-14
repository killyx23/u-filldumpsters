import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { PlanCard } from '@/components/PlanCard';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDumpFees } from '@/hooks/useDumpFees';
import { fetchHomepageServices, mapServiceToPlanCard, groupServicesForDisplay } from '@/utils/servicePlan';
import { fetchTemporaryServiceAvailabilityMap } from '@/utils/temporaryServiceAvailability';

export const Plans = ({ onSelectPlan }) => {
    const [plans, setPlans] = useState([]);
    const [availability, setAvailability] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { dumpFees } = useDumpFees();
    const [retryCount, setRetryCount] = useState(0);

    useEffect(() => {
        const fetchPlansAndAvailability = async () => {
            setLoading(true);
            setError(null);

            try {
                const { error: testError } = await supabase
                    .from('services')
                    .select('id')
                    .limit(1);

                if (testError) {
                    throw new Error(`Connection test failed: ${testError.message}`);
                }

                const homepageResult = await fetchHomepageServices(supabase);
                if (homepageResult.error) throw homepageResult.error;

                const frontendPlans = (homepageResult.data || []).map((s, i) =>
                    mapServiceToPlanCard(s, i)
                );
                setPlans(frontendPlans);

                if (frontendPlans.length === 0) {
                    setError('No bookable services are configured. Please try again later.');
                    setLoading(false);
                    return;
                }

                const newAvailability = await fetchTemporaryServiceAvailabilityMap(frontendPlans);
                setAvailability(newAvailability);
            } catch (err) {
                console.error('[Plans] Fatal error:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchPlansAndAvailability();
    }, [retryCount]);

    const plansWithDumpFees = plans.map((plan) => {
        const dumpFeeData = dumpFees.find((df) => df.service_id === plan.id);
        const enhancedPlan = { ...plan };

        if (dumpFeeData) {
            enhancedPlan.dynamicDumpFee = parseFloat(dumpFeeData.fee_per_ton).toFixed(2);
            enhancedPlan.dynamicMaxTons = dumpFeeData.max_tons
                ? parseFloat(dumpFeeData.max_tons)
                : null;
        }

        return enhancedPlan;
    });

    const groupedPlans = groupServicesForDisplay(plansWithDumpFees);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-96">
                <Loader2 className="h-16 w-16 animate-spin text-yellow-400" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col justify-center items-center h-96 text-center px-4">
                <AlertCircle className="h-16 w-16 text-red-400 mb-4" />
                <h3 className="text-2xl font-bold text-white mb-2">Unable to Load Services</h3>
                <p className="text-blue-200 max-w-md">
                    We're experiencing connection issues. Please refresh the page or contact us for assistance.
                </p>
                <p className="text-sm text-gray-400 mt-2">{error}</p>
                <Button
                    type="button"
                    variant="outline"
                    className="mt-6 border-yellow-400 text-yellow-400 hover:bg-yellow-400/10"
                    onClick={() => setRetryCount((c) => c + 1)}
                >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Try again
                </Button>
            </div>
        );
    }

    const valueProps = [
        'Simple and Fast Online Scheduling',
        'Up-Front and Competitive Pricing',
        'Professional Service',
    ];

    const gridClassFor = (count) =>
        count >= 4
            ? 'grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-6 xl:gap-8 gap-y-16 w-full'
            : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 xl:gap-8 gap-y-16 w-full';

    return (
        <section id="choose-your-service" className="py-20 px-4 sm:px-6 lg:px-8 xl:px-10 scroll-mt-24">
            <div className="w-full max-w-[1920px] mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="text-center mb-12"
                >
                    <h2
                        className="text-4xl lg:text-5xl font-extrabold text-white mb-4 tracking-tight"
                        style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
                    >
                        Choose Your Service
                    </h2>
                    <p className="text-xl text-blue-200 max-w-2xl mx-auto">
                        Select the perfect solution for your project, backed by reliable service.
                    </p>
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

                {groupedPlans.map((group, groupIndex) => (
                    <div key={group.slug} className={groupIndex < groupedPlans.length - 1 ? 'mb-20' : ''}>
                        {group.name && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5 }}
                                className="text-center mb-10"
                            >
                                <h3 className="text-2xl lg:text-3xl font-bold text-yellow-400 mb-2">
                                    {group.name}
                                </h3>
                                {group.description && (
                                    <p className="text-blue-200 max-w-2xl mx-auto">{group.description}</p>
                                )}
                            </motion.div>
                        )}
                        <div className={gridClassFor(group.services.length)}>
                            {group.services.map((plan) => {
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
                    </div>
                ))}

                <motion.div
                    initial={{ opacity: 0, y: 50 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.5 }}
                    className="text-center mt-20 max-w-3xl mx-auto"
                >
                    <h3 className="text-2xl font-bold text-yellow-400 mb-3">U-Fill Dumpsters LLC</h3>
                    <p className="text-lg text-blue-200 leading-relaxed">
                        Your trusted partner for waste management solutions. We're committed to providing
                        fast, reliable, and affordable services to help you get the job done right.
                    </p>
                </motion.div>
            </div>
        </section>
    );
};
