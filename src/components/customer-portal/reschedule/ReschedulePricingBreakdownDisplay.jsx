import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/api/EcommerceApi';
import { Receipt, Loader2, ArrowRight, AlertCircle } from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';

export const ReschedulePricingBreakdownDisplay = ({ 
    bookingId,
    originalService, 
    originalAddonsList = [], 
    originalCosts, 
    newService, 
    newAddonsList = [], 
    newDropOffDate, 
    newPickupDate,
    distanceMiles,
    isManualAddress = false
}) => {
    const [newCosts, setNewCosts] = useState(null);
    const [loading, setLoading] = useState(true);
    const [allOriginalAddons, setAllOriginalAddons] = useState([]);

    const currencyInfo = { code: 'USD', symbol: '$' };

    // Fetch ALL original add-ons from booking_equipment table
    useEffect(() => {
        const fetchOriginalAddons = async () => {
            if (!bookingId) return;
            
            try {
                const { data: bookingEquip, error } = await supabase
                    .from('booking_equipment')
                    .select('*, equipment(*)')
                    .eq('booking_id', bookingId);
                
                if (error) throw error;
                
                const equipmentAddons = (bookingEquip || []).map(be => ({
                    name: be.equipment?.name || 'Unknown Equipment',
                    quantity: be.quantity || 1,
                    price: Number(be.equipment?.price || 0),
                    type: 'equipment'
                }));

                // Add insurance from originalAddonsList if present
                const insuranceAddon = originalAddonsList.find(a => 
                    a.id === 'insurance' || 
                    (a.name && a.name.toLowerCase().includes('insurance'))
                );

                const combined = [...equipmentAddons];
                if (insuranceAddon) {
                    combined.push({
                        name: insuranceAddon.name,
                        quantity: 1,
                        price: Number(insuranceAddon.price || 25),
                        type: 'insurance'
                    });
                }

                setAllOriginalAddons(combined);
            } catch (error) {
                console.error('Error fetching original add-ons:', error);
                setAllOriginalAddons(originalAddonsList);
            }
        };
        
        fetchOriginalAddons();
    }, [bookingId, originalAddonsList]);

    // Calculate new costs with detailed breakdown
    useEffect(() => {
        setLoading(true);
        const timer = setTimeout(() => {
            const calculateCosts = () => {
                if (!newService) return null;

                const basePrice = Number(newService.base_price) || 0;
                const deliveryFee = Number(newService.delivery_fee) || 0;
                const mileageRate = Number(newService.mileage_rate) || 0.85;
                
                // Calculate days
                let days = 1;
                if (newDropOffDate && newPickupDate) {
                    days = differenceInDays(newPickupDate, newDropOffDate) + 1;
                    days = Math.max(1, days);
                }

                // Calculate BASE rental cost (without delivery or mileage)
                let baseRentalCost = 0;
                if (newService.id === 1) {
                    baseRentalCost = days === 7 ? 500 : basePrice + Math.max(0, days - 1) * 50;
                } else if (newService.id === 2 || newService.id === 4) {
                    baseRentalCost = basePrice * days;
                } else if (newService.id === 3) {
                    baseRentalCost = basePrice;
                }

                // Delivery fee for delivery services
                const isDeliveryService = newService.id === 1 || newService.id === 4 || newService.id === 3;
                const deliveryFeeApplied = isDeliveryService ? deliveryFee : 0;

                // Mileage charge (only if address is verified, otherwise pending)
                let mileageCharge = 0;
                if (isDeliveryService && distanceMiles > 0 && !isManualAddress) {
                    mileageCharge = distanceMiles * 2 * mileageRate; // Round-trip
                }

                // Calculate add-ons with deduplication (remove duplicate insurance)
                const addonsMap = new Map();
                if (Array.isArray(newAddonsList)) {
                    newAddonsList.forEach(addon => {
                        const name = (addon?.name || '').toLowerCase();
                        if (name && !addonsMap.has(name)) {
                            addonsMap.set(name, {
                                name: addon.name,
                                quantity: Number(addon?.quantity) || 1,
                                price: Number(addon?.price) || 0,
                                total: (Number(addon?.price) || 0) * (Number(addon?.quantity) || 1)
                            });
                        }
                    });
                }
                const addons = Array.from(addonsMap.values());

                const addonsCost = addons.reduce((sum, addon) => sum + addon.total, 0);
                const subtotal = baseRentalCost + deliveryFeeApplied + mileageCharge + addonsCost;
                const tax = subtotal * 0.07;
                const total = subtotal + tax;

                return {
                    baseRentalCost: Math.round(baseRentalCost * 100) / 100,
                    deliveryFee: Math.round(deliveryFeeApplied * 100) / 100,
                    mileageCharge: Math.round(mileageCharge * 100) / 100,
                    addons,
                    addonsCost: Math.round(addonsCost * 100) / 100,
                    subtotal: Math.round(subtotal * 100) / 100,
                    tax: Math.round(tax * 100) / 100,
                    total: Math.round(total * 100) / 100,
                    days,
                    isManualAddress
                };
            };

            const calculated = calculateCosts();
            setNewCosts(calculated);
            setLoading(false);
        }, 600);
        
        return () => clearTimeout(timer);
    }, [newService, newAddonsList, newDropOffDate, newPickupDate, distanceMiles, isManualAddress]);

    if (loading || !newCosts || !originalCosts) {
        return (
            <div className="flex flex-col items-center justify-center py-32 space-y-5 h-full">
                <Loader2 className="h-12 w-12 animate-spin text-gold" />
                <p className="text-gray-400 text-base font-medium tracking-wide animate-pulse">Calculating comprehensive pricing...</p>
            </div>
        );
    }

    // Calculate original booking breakdown with CORRECT mileage
    const isOriginalDeliveryService = [1, 3, 4].includes(originalService.id);
    const originalDeliveryFee = isOriginalDeliveryService ? Number(originalService.delivery_fee || 0) : 0;
    
    // CORRECT mileage calculation for original booking
    const originalDistanceMiles = Number(originalCosts.distanceMiles || 0);
    const originalMileageRate = Number(originalService.mileage_rate || 0.85);
    const originalMileageCharge = originalDistanceMiles * 2 * originalMileageRate; // Round-trip
    
    const originalBaseRental = Number(originalCosts.serviceCost) - originalDeliveryFee - originalMileageCharge;

    // Calculate original add-ons total (deduplicate insurance)
    const originalAddonsTotal = allOriginalAddons.reduce((sum, addon) => {
        return sum + (Number(addon.price || 0) * Number(addon.quantity || 1));
    }, 0);

    // Recalculate CORRECT original totals
    const correctOriginalSubtotal = originalBaseRental + originalDeliveryFee + originalMileageCharge + originalAddonsTotal;
    const correctOriginalTax = correctOriginalSubtotal * 0.07;
    const correctOriginalTotal = correctOriginalSubtotal + correctOriginalTax;

    const difference = newCosts.total - correctOriginalTotal;
    const isCredit = difference < 0;
    const isCharge = difference > 0;

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
                                <span>Base Rental <span className="text-xs text-gray-500 ml-2">({originalService?.name})</span></span>
                                <span className="font-bold">{formatCurrency(originalBaseRental * 100, currencyInfo)}</span>
                            </div>
                            
                            {originalDeliveryFee > 0 && (
                                <div className="flex justify-between items-center text-gray-300">
                                    <span>Delivery Fee (Flat)</span>
                                    <span className="font-bold">{formatCurrency(originalDeliveryFee * 100, currencyInfo)}</span>
                                </div>
                            )}

                            {originalMileageCharge > 0 && (
                                <div className="flex justify-between items-center text-gray-300">
                                    <span className="text-sm">Mileage Charge ({originalDistanceMiles.toFixed(1)} mi × 2)</span>
                                    <span>{formatCurrency(originalMileageCharge * 100, currencyInfo)}</span>
                                </div>
                            )}
                            
                            {allOriginalAddons.length > 0 && (
                                <div className="pl-5 border-l-2 border-gray-800 space-y-2.5 py-2">
                                    <span className="text-xs font-black text-gray-600 uppercase tracking-widest block mb-2">Add-ons & Equipment</span>
                                    {allOriginalAddons.map((addon, idx) => (
                                        <div key={`orig-addon-${idx}`} className="flex justify-between text-sm text-gray-400">
                                            <span>{addon.name} <span className="text-gray-600 text-xs ml-1">x{addon.quantity}</span></span>
                                            <span>{formatCurrency(addon.price * addon.quantity * 100, currencyInfo)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            
                            <div className="flex justify-between items-center text-gray-300 mt-4 pt-4 border-t border-gray-800/50">
                                <span>Subtotal</span>
                                <span className="font-bold">{formatCurrency(correctOriginalSubtotal * 100, currencyInfo)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center text-gray-400">
                                <span>Estimated Tax (7%)</span>
                                <span>{formatCurrency(correctOriginalTax * 100, currencyInfo)}</span>
                            </div>
                        </div>

                        <div className="bg-gray-950 p-5 rounded-xl border border-gray-800 mt-8">
                            <div className="flex justify-between items-center">
                                <span className="text-gray-400 font-black text-xs uppercase tracking-widest">Original Receipt</span>
                                <span className="text-2xl font-black text-gray-200">
                                    {formatCurrency(correctOriginalTotal * 100, currencyInfo)}
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
                                <span>Base Rental <span className="text-xs text-gold-light/60 ml-2">({newService?.name} - {newCosts.days} {newCosts.days === 1 ? 'day' : 'days'})</span></span>
                                <span className="font-bold">{formatCurrency(newCosts.baseRentalCost * 100, currencyInfo)}</span>
                            </div>
                            
                            {newCosts.deliveryFee > 0 && (
                                <div className="flex justify-between items-center text-white">
                                    <span>Delivery Fee (Flat)</span>
                                    <span className="font-bold">{formatCurrency(newCosts.deliveryFee * 100, currencyInfo)}</span>
                                </div>
                            )}

                            {isManualAddress && newCosts.deliveryFee > 0 ? (
                                <div className="flex justify-between items-center text-orange-300 bg-orange-950/30 p-3 rounded-lg border border-orange-500/30">
                                    <span className="text-sm">Mileage Charge</span>
                                    <span className="font-bold text-sm">Pending Manual Review</span>
                                </div>
                            ) : newCosts.mileageCharge > 0 ? (
                                <div className="flex justify-between items-center text-gray-300">
                                    <span className="text-sm">Mileage Charge ({distanceMiles.toFixed(1)} mi × 2)</span>
                                    <span>{formatCurrency(newCosts.mileageCharge * 100, currencyInfo)}</span>
                                </div>
                            ) : null}
                            
                            {newCosts.addons.length > 0 && (
                                <div className="pl-5 border-l-2 border-gold/30 space-y-2.5 py-2">
                                    <span className="text-xs font-black text-gold-light uppercase tracking-widest block mb-2">Selected Add-ons</span>
                                    {newCosts.addons.map((addon, idx) => (
                                        <div key={`new-addon-${idx}`} className="flex justify-between text-sm text-gray-300">
                                            <span>{addon.name} <span className="text-gray-500 text-xs ml-1">x{addon.quantity}</span></span>
                                            <span>{formatCurrency(addon.total * 100, currencyInfo)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="flex justify-between items-center text-white mt-4 pt-4 border-t border-[hsl(var(--gold)_/_0.2)]">
                                <span>New Subtotal</span>
                                <span className="font-bold">{formatCurrency(newCosts.subtotal * 100, currencyInfo)}</span>
                            </div>

                            <div className="flex justify-between items-center text-gray-300">
                                <span>Estimated Tax (7%)</span>
                                <span>{formatCurrency(newCosts.tax * 100, currencyInfo)}</span>
                            </div>
                        </div>

                        <div className="bg-gray-950 p-5 rounded-xl border border-[hsl(var(--gold)_/_0.4)] mt-8">
                            <div className="flex justify-between items-center">
                                <span className="text-gold-light font-black text-xs uppercase tracking-widest">New Total</span>
                                <span className="text-2xl font-black text-gold drop-shadow-[0_0_8px_hsla(var(--gold),0.4)]">
                                    {formatCurrency(newCosts.total * 100, currencyInfo)}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Manual Address Disclaimer */}
            {isManualAddress && (
                <Card className="bg-orange-950/20 border-orange-500/30">
                    <CardContent className="p-6">
                        <div className="flex items-start gap-4">
                            <AlertCircle className="w-6 h-6 text-orange-400 flex-shrink-0 mt-1" />
                            <div>
                                <h4 className="text-orange-300 font-bold text-base mb-2">Manual Address Review</h4>
                                <p className="text-orange-200/80 text-sm leading-relaxed">
                                    This address will be manually reviewed by our booking department. Mileage distance (if applicable) and any additional delivery charges will be calculated and applied at the current mileage rate set for this service upon approval.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

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
                    <p className="text-sm text-gray-400 max-w-md">The price difference to be charged or credited after admin approval. Rescheduling fees (if applicable) are assessed at final approval.</p>
                </div>
                <div className="flex items-center gap-4 bg-gray-950 px-6 py-4 rounded-xl border border-gray-800">
                    <div className="hidden sm:flex flex-col items-end mr-2">
                        <span className="text-xs font-bold text-gray-500 uppercase">Original</span>
                        <span className="text-sm font-medium text-gray-400 line-through">{formatCurrency(correctOriginalTotal * 100, currencyInfo)}</span>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-600 hidden sm:block" />
                    <span className={`text-4xl font-black ${
                        isCharge 
                            ? 'text-red-400 drop-shadow-[0_0_10px_rgba(248,113,113,0.3)]' 
                            : isCredit 
                                ? 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.3)]' 
                                : 'text-white'
                    }`}>
                        {isCharge ? '+' : ''}{formatCurrency(difference * 100, currencyInfo)}
                    </span>
                </div>
            </div>
        </div>
    );
};