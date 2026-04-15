
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/api/EcommerceApi';
import { Receipt, Loader2, ArrowRight } from 'lucide-react';
import { calculateBookingCosts, calculateDays, calculateRescheduleDifference } from '@/utils/rescheduleCalculations';
import { safeExtractString, safeExtractNumber } from '@/utils/stringExtractors';

export const ReschedulePricingBreakdownDisplay = ({ 
    originalService, 
    originalAddonsList = [], 
    originalCosts, 
    newService, 
    newAddonsList = [], 
    newDropOffDate, 
    newPickupDate,
    distanceMiles
}) => {
    const [newCosts, setNewCosts] = useState(null);
    const [difference, setDifference] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        const timer = setTimeout(() => {
            const newDays = calculateDays(newDropOffDate, newPickupDate);
            const calculatedNewCosts = calculateBookingCosts(newService, newDays, newAddonsList, distanceMiles);
            
            setNewCosts(calculatedNewCosts);
            setDifference(calculateRescheduleDifference(originalCosts, calculatedNewCosts));
            setLoading(false);
        }, 600);
        
        return () => clearTimeout(timer);
    }, [newService, newAddonsList, newDropOffDate, newPickupDate, distanceMiles, originalCosts]);

    const currencyInfo = { code: 'USD', symbol: '$' };

    if (loading || !newCosts || !originalCosts) {
        return (
            <div className="flex flex-col items-center justify-center py-32 space-y-5 h-full">
                <Loader2 className="h-12 w-12 animate-spin text-gold" />
                <p className="text-gray-400 text-base font-medium tracking-wide animate-pulse">Calculating comprehensive pricing...</p>
            </div>
        );
    }

    const diffVal = safeExtractNumber(difference?.finalAmountDue, 0);
    const isCredit = diffVal < 0;
    const isCharge = diffVal > 0;

    const originalServiceName = safeExtractString(originalService?.name, 'Standard Service');
    const newServiceName = safeExtractString(newService?.name, 'New Service');

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto w-full">
            <div className="text-center space-y-3 mb-6">
                <div className="mx-auto w-14 h-14 bg-[hsl(var(--gold)_/_0.1)] border border-[hsl(var(--gold)_/_0.2)] rounded-2xl flex items-center justify-center mb-2 shadow-gold">
                    <Receipt className="w-7 h-7 text-gold" />
                </div>
                <h2 className="text-3xl font-extrabold text-white tracking-tight">Financial Breakdown</h2>
                <p className="text-base text-gray-400 max-w-2xl mx-auto">Detailed comparison of your original receipt vs. the new requested booking.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                {/* Original Costs Card */}
                <Card className="bg-gray-900/60 border-gray-800 shadow-xl rounded-2xl h-full flex flex-col">
                    <CardContent className="p-8 flex flex-col h-full">
                        <h4 className="text-sm uppercase tracking-widest text-gray-500 font-bold border-b border-gray-800 pb-4 mb-6 flex items-center">
                            <span className="w-2 h-2 rounded-full bg-gray-600 mr-3"></span> Original Booking
                        </h4>
                        
                        <div className="space-y-4 flex-1 text-base">
                            <div className="flex justify-between items-center text-gray-300">
                                <span>Service Cost <span className="text-xs text-gray-500 ml-2">({originalServiceName})</span></span>
                                <span className="font-bold">{formatCurrency(safeExtractNumber(originalCosts?.serviceCost) * 100, currencyInfo)}</span>
                            </div>
                            
                            {originalAddonsList?.length > 0 && (
                                <div className="pl-5 border-l-2 border-gray-800 space-y-2.5 py-2">
                                    <span className="text-xs font-black text-gray-600 uppercase tracking-widest block mb-2">Original Add-ons</span>
                                    {originalAddonsList.map((addon, idx) => {
                                        const aName = safeExtractString(addon?.name, 'Add-on');
                                        const aPrice = safeExtractNumber(addon?.price, 0);
                                        const aQty = safeExtractNumber(addon?.quantity, 1);
                                        return (
                                            <div key={`orig-addon-${idx}`} className="flex justify-between text-sm text-gray-400">
                                                <span>{aName} <span className="text-gray-600 text-xs ml-1">x{aQty}</span></span>
                                                <span>{formatCurrency(aPrice * aQty * 100, currencyInfo)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            
                            <div className="flex justify-between items-center text-gray-300 mt-4 pt-4 border-t border-gray-800/50">
                                <span>Subtotal</span>
                                <span className="font-bold">{formatCurrency(safeExtractNumber(originalCosts?.subtotal) * 100, currencyInfo)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center text-gray-400">
                                <span>Estimated Tax (7%)</span>
                                <span>{formatCurrency(safeExtractNumber(originalCosts?.tax) * 100, currencyInfo)}</span>
                            </div>
                        </div>

                        <div className="bg-gray-950 p-5 rounded-xl border border-gray-800 mt-8">
                            <div className="flex justify-between items-center">
                                <span className="text-gray-400 font-black text-xs uppercase tracking-widest">Original Receipt</span>
                                <span className="text-2xl font-black text-gray-200">
                                    {formatCurrency(safeExtractNumber(originalCosts?.total) * 100, currencyInfo)}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* New Costs Card */}
                <Card className="bg-[hsl(var(--gold)_/_0.03)] border-[hsl(var(--gold)_/_0.3)] shadow-[0_0_30px_hsla(var(--gold),0.05)] rounded-2xl relative overflow-hidden h-full flex flex-col">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-gold to-gold-light"></div>
                    <CardContent className="p-8 flex flex-col h-full">
                        <h4 className="text-sm uppercase tracking-widest text-gold-light font-bold border-b border-[hsl(var(--gold)_/_0.2)] pb-4 mb-6 flex items-center">
                            <span className="w-2 h-2 rounded-full bg-gold mr-3 shadow-gold"></span> New Request
                        </h4>
                        
                        <div className="space-y-4 flex-1 text-base">
                            <div className="flex justify-between items-center text-white">
                                <span>New Service Cost <span className="text-xs text-gold-light/60 ml-2">({newServiceName})</span></span>
                                <span className="font-bold">{formatCurrency(safeExtractNumber(newCosts?.serviceCost) * 100, currencyInfo)}</span>
                            </div>
                            
                            {newAddonsList?.length > 0 && (
                                <div className="pl-5 border-l-2 border-gold/30 space-y-2.5 py-2">
                                    <span className="text-xs font-black text-gold-light uppercase tracking-widest block mb-2">Selected Add-ons</span>
                                    {newAddonsList.map((addon, idx) => {
                                        const aName = safeExtractString(addon?.name, 'Add-on');
                                        const aPrice = safeExtractNumber(addon?.price, 0);
                                        const aQty = safeExtractNumber(addon?.quantity, 1);
                                        return (
                                            <div key={`new-addon-${idx}`} className="flex justify-between text-sm text-gray-300">
                                                <span>{aName} <span className="text-gray-500 text-xs ml-1">x{aQty}</span></span>
                                                <span>{formatCurrency(aPrice * aQty * 100, currencyInfo)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="flex justify-between items-center text-white mt-4 pt-4 border-t border-[hsl(var(--gold)_/_0.2)]">
                                <span>New Subtotal</span>
                                <span className="font-bold">{formatCurrency(safeExtractNumber(newCosts?.subtotal) * 100, currencyInfo)}</span>
                            </div>

                            <div className="flex justify-between items-center text-gray-300">
                                <span>Estimated Tax (7%)</span>
                                <span>{formatCurrency(safeExtractNumber(newCosts?.tax) * 100, currencyInfo)}</span>
                            </div>
                        </div>

                        <div className="bg-gray-950 p-5 rounded-xl border border-[hsl(var(--gold)_/_0.4)] mt-8">
                            <div className="flex justify-between items-center">
                                <span className="text-gold-light font-black text-xs uppercase tracking-widest">New Total</span>
                                <span className="text-2xl font-black text-gold drop-shadow-[0_0_8px_hsla(var(--gold),0.4)]">
                                    {formatCurrency(safeExtractNumber(newCosts?.total) * 100, currencyInfo)}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Final Difference Banner */}
            <div className={`p-8 rounded-2xl border-2 flex flex-col md:flex-row justify-between items-center gap-6 shadow-2xl ${
                isCharge 
                    ? 'bg-red-950/30 border-red-900/60' 
                    : isCredit 
                        ? 'bg-green-950/30 border-green-900/60' 
                        : 'bg-gray-900 border-gray-800'
            }`}>
                <div className="text-center md:text-left">
                    <h3 className="text-xl font-extrabold text-white mb-2">Final Amount Due / (Credit)</h3>
                    <p className="text-sm text-gray-400 max-w-md">The physical difference to be charged or credited after admin approval. Rescheduling fees (if applicable) are assessed at final approval.</p>
                </div>
                <div className="flex items-center gap-4 bg-gray-950 px-6 py-4 rounded-xl border border-gray-800">
                    <div className="hidden sm:flex flex-col items-end mr-2">
                        <span className="text-xs font-bold text-gray-500 uppercase">Original</span>
                        <span className="text-sm font-medium text-gray-400 line-through">{formatCurrency(safeExtractNumber(originalCosts?.total) * 100, currencyInfo)}</span>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-600 hidden sm:block" />
                    <span className={`text-4xl font-black ${
                        isCharge 
                            ? 'text-red-400 drop-shadow-[0_0_10px_rgba(248,113,113,0.3)]' 
                            : isCredit 
                                ? 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.3)]' 
                                : 'text-white'
                    }`}>
                        {isCharge ? '+' : ''}{formatCurrency(diffVal * 100, currencyInfo)}
                    </span>
                </div>
            </div>
        </div>
    );
};
