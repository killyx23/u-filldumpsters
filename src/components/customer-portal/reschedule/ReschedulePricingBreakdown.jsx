
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/api/EcommerceApi';
import { Receipt, TrendingDown, TrendingUp, Loader2 } from 'lucide-react';
import { calculateComprehensivePricing } from '@/utils/rescheduleCalculations';

export const ReschedulePricingBreakdown = ({ booking, newService, newDropOffDate, newPickupDate, selectedAddons }) => {
    const [pricing, setPricing] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadPricing = async () => {
            setLoading(true);
            try {
                const distanceMiles = typeof booking?.customers?.distance_miles === 'object' ? 
                    Number(booking.customers.distance_miles?.value || 0) : 
                    Number(booking?.customers?.distance_miles || 0);
                    
                const result = await calculateComprehensivePricing(
                    booking, 
                    newService?.id ? newService : null, 
                    newDropOffDate, 
                    newPickupDate, 
                    selectedAddons, 
                    distanceMiles
                );
                setPricing(result);
            } catch (err) {
                console.error("Error calculating pricing:", err);
            } finally {
                setLoading(false);
            }
        };

        if (booking && newService) {
            loadPricing();
        }
    }, [booking, newService, newDropOffDate, newPickupDate, selectedAddons]);

    const currencyInfo = { code: 'USD', symbol: '$' };

    if (loading || !pricing) {
        return (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 h-full">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
                <p className="text-gray-400 text-sm">Calculating final pricing...</p>
            </div>
        );
    }

    const safeExtractNumber = (val) => {
        if (val == null) return 0;
        if (typeof val === 'object') {
            const extracted = Number(val?.value || val?.price || val?.amount || 0);
            return isNaN(extracted) ? 0 : extracted;
        }
        const parsed = Number(val);
        return isNaN(parsed) ? 0 : parsed;
    };

    const originalServiceCost = safeExtractNumber(pricing?.originalServiceCost);
    const originalAddonsCost = safeExtractNumber(pricing?.originalAddonsCost);
    const originalTotal = safeExtractNumber(pricing?.originalTotal);
    const newServiceCost = safeExtractNumber(pricing?.newServiceCost);
    const serviceDifference = safeExtractNumber(pricing?.serviceDifference);
    const newAddonsCost = safeExtractNumber(pricing?.newAddonsCost);
    const newSubtotal = safeExtractNumber(pricing?.newSubtotal);
    const taxAmount = safeExtractNumber(pricing?.taxAmount);
    const finalAmountDue = safeExtractNumber(pricing?.finalAmountDue);
    const newTotalWithTax = safeExtractNumber(pricing?.newTotalWithTax);

    const safeServiceName = typeof newService?.name === 'object' ? (newService.name?.name || newService.name?.value || 'Service') : (newService?.name || 'Service');

    return (
        <div className="space-y-4 animate-in fade-in duration-300 max-w-5xl mx-auto w-full">
            <div className="text-center space-y-1 mb-2">
                <div className="mx-auto w-10 h-10 bg-yellow-500/10 rounded-full flex items-center justify-center mb-1">
                    <Receipt className="w-5 h-5 text-yellow-500" />
                </div>
                <h2 className="text-2xl font-extrabold text-white tracking-tight">Pricing Breakdown</h2>
                <p className="text-sm text-gray-400">Review the itemized changes in cost for your rescheduled dates, service, and add-ons.</p>
            </div>

            <Card className="bg-gray-900 border-gray-800 shadow-xl overflow-hidden rounded-2xl">
                <CardContent className="p-0">
                    <div className="p-4 md:p-5 space-y-3">
                        
                        <div className="space-y-1">
                            <h4 className="text-xs uppercase tracking-widest text-gray-500 font-bold border-b border-gray-800 pb-1 mb-2">Original Costs</h4>
                            <div className="pricing-row text-gray-400">
                                <div><div className="font-semibold text-white">Original Service Cost</div></div>
                                <div className="font-bold text-gray-300">{formatCurrency(originalServiceCost * 100, currencyInfo)}</div>
                            </div>
                            <div className="pricing-row text-gray-400">
                                <div><div className="font-semibold text-white">Original Add-ons</div></div>
                                <div className="font-bold text-gray-300">{formatCurrency(originalAddonsCost * 100, currencyInfo)}</div>
                            </div>
                            <div className="flex justify-between items-center text-sm pt-2 text-gray-500">
                                <span>Original Total (Pre-tax)</span>
                                <span>{formatCurrency(originalTotal * 100, currencyInfo)}</span>
                            </div>
                        </div>

                        <div className="space-y-1 pt-4">
                            <h4 className="text-xs uppercase tracking-widest text-yellow-500/70 font-bold border-b border-gray-800 pb-1 mb-2">New Reservation</h4>
                            
                            <div className="pricing-row text-gray-400">
                                <div>
                                    <div className="font-semibold text-white">New Service Cost</div>
                                    <div className="text-xs">Based on {safeServiceName}</div>
                                </div>
                                <div className="font-bold text-white text-base">{formatCurrency(newServiceCost * 100, currencyInfo)}</div>
                            </div>

                            <div className="pricing-row bg-gray-950 p-2 -mx-2 rounded-lg my-1 border border-gray-800">
                                <div>
                                    <div className="font-semibold text-white">Service Difference</div>
                                    <div className="text-xs text-gray-400">Difference in base rental costs</div>
                                </div>
                                <div className={`font-bold text-base flex items-center ${serviceDifference > 0 ? 'text-red-400' : serviceDifference < 0 ? 'text-green-400' : 'text-gray-400'}`}>
                                    {serviceDifference > 0 ? <TrendingUp className="w-4 h-4 mr-1.5" /> : serviceDifference < 0 ? <TrendingDown className="w-4 h-4 mr-1.5" /> : null}
                                    {serviceDifference > 0 ? '+' : ''}{formatCurrency(serviceDifference * 100, currencyInfo)}
                                </div>
                            </div>

                            <div className="pricing-row text-gray-400">
                                <div><div className="font-semibold text-white">Selected Add-ons</div></div>
                                <div className="font-bold text-white text-base">+{formatCurrency(newAddonsCost * 100, currencyInfo)}</div>
                            </div>
                            
                            <div className="pricing-row text-gray-400 border-t border-gray-700 mt-2 pt-2">
                                <div><div className="font-semibold text-white">New Subtotal</div></div>
                                <div className="font-bold text-white text-base">{formatCurrency(newSubtotal * 100, currencyInfo)}</div>
                            </div>

                            <div className="pricing-row text-gray-400">
                                <div><div className="font-semibold text-white">Estimated Tax (7%)</div></div>
                                <div className="font-bold text-white text-base">{formatCurrency(taxAmount * 100, currencyInfo)}</div>
                            </div>
                        </div>

                        <div className="pt-3 pb-1 mt-2">
                            <div className="flex justify-between items-center bg-gray-950 p-3 rounded-xl border border-gray-800">
                                <span className="text-gray-300 font-semibold text-sm">Final Amount Due / (Credit)</span>
                                <span className={`text-base font-bold px-3 py-1 rounded-lg ${finalAmountDue > 0 ? 'bg-red-900/20 text-red-400 border border-red-500/30' : finalAmountDue < 0 ? 'bg-green-900/20 text-green-400 border border-green-500/30' : 'bg-gray-800 text-white'}`}>
                                    {finalAmountDue > 0 ? '+' : ''}{formatCurrency(finalAmountDue * 100, currencyInfo)}
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="bg-gradient-to-r from-yellow-600/20 via-yellow-500/10 to-yellow-600/20 p-4 md:p-6 border-t border-yellow-500/30">
                        <div className="flex flex-col md:flex-row justify-between items-center gap-2 text-center md:text-left">
                            <div>
                                <h3 className="text-lg font-bold text-white uppercase tracking-widest leading-none">New Grand Total</h3>
                                <p className="text-yellow-500/80 text-xs mt-1">Total value of updated reservation (w/ tax)</p>
                            </div>
                            <div className="text-3xl md:text-4xl font-black text-yellow-400 drop-shadow-[0_0_10px_rgba(234,179,8,0.3)]">
                                {formatCurrency(newTotalWithTax * 100, currencyInfo)}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
