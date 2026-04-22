import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/api/EcommerceApi';
import { Receipt, Loader2, ArrowRight, AlertCircle, Lock, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { calculateDays } from '@/utils/rescheduleCalculations';
import { calculateRoundTripDistance } from '@/utils/distanceCalculationHelper';
import { Button } from '@/components/ui/button';

export const ReschedulePricingBreakdown = ({ 
    bookingId,
    originalService, 
    originalAddonsList, 
    originalCosts,
    newService, 
    newAddonsList, 
    newDropOffDate, 
    newPickupDate,
    distanceMiles,
    isManualAddress
}) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [originalDetailedCosts, setOriginalDetailedCosts] = useState(null);
    const [newCosts, setNewCosts] = useState(null);
    const [mileageLogic, setMileageLogic] = useState(null);
    const [originalBooking, setOriginalBooking] = useState(null);
    const [retryCount, setRetryCount] = useState(0);

    const currencyInfo = { code: 'USD', symbol: '$' };

    useEffect(() => {
        let isMounted = true;
        let timeoutId = null;

        const performAllCalculations = async () => {
            console.log('[ReschedulePricing] Starting calculations... (Attempt:', retryCount + 1, ')');
            setLoading(true);
            setError(null);

            // Reduced timeout to 5 seconds
            timeoutId = setTimeout(() => {
                if (isMounted && loading) {
                    console.error('[ReschedulePricing] Timeout reached after 5s');
                    setError('Calculation took too long. Using cached values.');
                    setLoading(false);
                }
            }, 5000);

            try {
                // STEP 1: Fetch original booking data with error handling
                console.log('[ReschedulePricing] Step 1: Fetching booking data...');
                if (!bookingId) {
                    throw new Error('Missing booking ID');
                }

                let booking = null;
                try {
                    const { data: bookingData, error: bookingError } = await supabase
                        .from('bookings')
                        .select('*, customers(*), booking_equipment(*, equipment(*))')
                        .eq('id', bookingId)
                        .single();
                    
                    if (bookingError) throw bookingError;
                    booking = bookingData;
                    console.log('[ReschedulePricing] Booking fetched successfully');
                } catch (err) {
                    console.error('[ReschedulePricing] Booking fetch failed:', err);
                    throw new Error('Failed to load booking data: ' + err.message);
                }
                
                if (!booking) throw new Error('Booking not found');
                if (!isMounted) return;
                setOriginalBooking(booking);

                // STEP 2: Calculate ORIGINAL costs using stored/cached mileage when available
                console.log('[ReschedulePricing] Step 2: Calculating original costs...');
                if (!originalService) {
                    throw new Error('Missing original service data');
                }

                const originalDays = calculateDays(booking.drop_off_date, booking.pickup_date);
                const originalMileageRate = Number(originalService.mileage_rate || 0.85);

                // Use STORED mileage first (faster, no API call needed)
                let originalTotalMiles = 0;
                let originalMileageCharge = 0;
                
                const storedMiles = booking.customers?.distance_miles;
                if (storedMiles && !isNaN(storedMiles)) {
                    // Use cached mileage from database
                    originalTotalMiles = parseFloat(storedMiles);
                    originalMileageCharge = originalTotalMiles * originalMileageRate;
                    console.log(`[ReschedulePricing] Using STORED mileage: ${originalTotalMiles} mi @ $${originalMileageRate}/mi = $${originalMileageCharge.toFixed(2)}`);
                } else {
                    // Fallback: calculate if no stored value
                    try {
                        const deliveryAddr = booking.delivery_address;
                        const customerAddress = deliveryAddr?.formatted_address || 
                            `${deliveryAddr?.street || booking.street}, ${deliveryAddr?.city || booking.city}, ${deliveryAddr?.state || booking.state} ${deliveryAddr?.zip || booking.zip}`;
                        
                        console.log('[ReschedulePricing] Calculating 3-point route for:', customerAddress);
                        originalTotalMiles = await calculateRoundTripDistance(customerAddress);
                        originalMileageCharge = originalTotalMiles * originalMileageRate;
                        console.log(`[ReschedulePricing] CALCULATED: ${originalTotalMiles} mi @ $${originalMileageRate}/mi = $${originalMileageCharge.toFixed(2)}`);
                    } catch (err) {
                        console.warn('[ReschedulePricing] Mileage calculation failed, using 0:', err);
                        originalTotalMiles = 0;
                        originalMileageCharge = 0;
                    }
                }

                // Extract ALL original add-ons including disposal services
                console.log('[ReschedulePricing] Extracting original add-ons...');
                const equipmentAddons = (booking.booking_equipment || []).map(be => {
                    const name = be.equipment?.name || 'Unknown Equipment';
                    const type = be.equipment?.type || 'rental';
                    console.log(`[ReschedulePricing] Original addon: ${name} (type: ${type}, qty: ${be.quantity})`);
                    
                    return {
                        name: name,
                        quantity: be.quantity || 1,
                        unitPrice: Number(be.equipment?.price || 0),
                        total: Number(be.equipment?.price || 0) * (be.quantity || 1),
                        type: type
                    };
                });

                // Check for insurance in addons JSON
                let insuranceAddon = null;
                if (booking.addons && typeof booking.addons === 'object') {
                    Object.entries(booking.addons).forEach(([key, val]) => {
                        if (key.toLowerCase().includes('insurance')) {
                            const price = typeof val === 'object' ? Number(val.price || 25) : Number(val || 25);
                            insuranceAddon = {
                                name: 'Premium Insurance',
                                quantity: 1,
                                unitPrice: price,
                                total: price,
                                type: 'service'
                            };
                            console.log('[ReschedulePricing] Original addon: Premium Insurance');
                        }
                    });
                }

                const allOriginalAddons = [...equipmentAddons];
                if (insuranceAddon) {
                    allOriginalAddons.push(insuranceAddon);
                }
                console.log(`[ReschedulePricing] Total original addons: ${allOriginalAddons.length}`);

                // Calculate service cost components
                const basePrice = Number(originalService.base_price || 0);
                const deliveryFee = Number(originalService.delivery_fee || 0);
                
                let baseRentalCost = 0;
                if (originalService.id === 1) {
                    baseRentalCost = originalDays === 7 ? 500 : basePrice + Math.max(0, originalDays - 1) * 50;
                } else if (originalService.id === 2 || originalService.id === 4) {
                    baseRentalCost = basePrice * originalDays;
                } else if (originalService.id === 3) {
                    baseRentalCost = basePrice;
                }

                const isDeliveryService = [1, 3, 4].includes(originalService.id);
                const deliveryFeeApplied = isDeliveryService ? deliveryFee : 0;

                const addonsTotal = allOriginalAddons.reduce((sum, a) => sum + a.total, 0);
                const originalSubtotal = baseRentalCost + deliveryFeeApplied + originalMileageCharge + addonsTotal;
                const originalTax = originalSubtotal * 0.07;
                const originalTotal = originalSubtotal + originalTax;

                const originalCostsData = {
                    baseRentalCost,
                    deliveryFee: deliveryFeeApplied,
                    mileageCharge: originalMileageCharge,
                    mileageDistance: originalTotalMiles,
                    mileageRate: originalMileageRate,
                    addons: allOriginalAddons,
                    addonsTotal,
                    subtotal: originalSubtotal,
                    tax: originalTax,
                    total: originalTotal,
                    days: originalDays
                };

                console.log('[ReschedulePricing] Original costs calculated:', originalCostsData);
                if (!isMounted) return;
                setOriginalDetailedCosts(originalCostsData);

                // STEP 3: Calculate NEW costs
                console.log('[ReschedulePricing] Step 3: Calculating new costs...');
                if (!newService || !newDropOffDate) {
                    throw new Error('Missing new service or dates');
                }

                const newDays = calculateDays(newDropOffDate, newPickupDate);
                const newBasePrice = Number(newService.base_price || 0);
                const newDeliveryFee = Number(newService.delivery_fee || 0);
                const newMileageRate = Number(newService.mileage_rate || 0.85);

                // Calculate base rental
                let newBaseRentalCost = 0;
                if (newService.id === 1) {
                    newBaseRentalCost = newDays === 7 ? 500 : newBasePrice + Math.max(0, newDays - 1) * 50;
                } else if (newService.id === 2 || newService.id === 4) {
                    newBaseRentalCost = newBasePrice * newDays;
                } else if (newService.id === 3) {
                    newBaseRentalCost = newBasePrice;
                }

                const isNewDeliveryService = [1, 3, 4].includes(newService.id);
                const newDeliveryFeeApplied = isNewDeliveryService ? newDeliveryFee : 0;

                // MILEAGE LOGIC: Use stored values when possible
                const originalAddress = booking?.delivery_address;
                const originalAddressStr = originalAddress?.formatted_address || 
                    `${originalAddress?.street}, ${originalAddress?.city}, ${originalAddress?.state} ${originalAddress?.zip}`;
                
                const newAddressStr = typeof distanceMiles === 'object' ? 
                    distanceMiles.formatted_address : 
                    (booking?.delivery_address?.formatted_address || originalAddressStr);

                const isSameAddress = originalAddressStr === newAddressStr;
                
                let newMileageCharge = 0;
                let newMileageExplanation = '';
                let newMileageDistance = 0;

                if (isNewDeliveryService) {
                    if (isSameAddress) {
                        // Use LOCKED original mileage (no calculation needed)
                        newMileageCharge = originalMileageCharge;
                        newMileageDistance = originalTotalMiles;
                        newMileageExplanation = `Locked from original (${newMileageDistance.toFixed(2)} mi @ $${originalMileageRate.toFixed(2)}/mi)`;
                        console.log('[ReschedulePricing] Same address - using original mileage');
                    } else if (isManualAddress) {
                        newMileageCharge = 0;
                        newMileageExplanation = 'Pending manual address verification';
                        console.log('[ReschedulePricing] Manual address - pending review');
                    } else {
                        // Calculate new mileage (with error handling)
                        try {
                            console.log('[ReschedulePricing] Calculating NEW route for:', newAddressStr);
                            const calculatedMiles = await calculateRoundTripDistance(newAddressStr);
                            const calculatedCharge = calculatedMiles * newMileageRate;
                            
                            console.log(`[ReschedulePricing] NEW: ${calculatedMiles} mi @ $${newMileageRate}/mi = $${calculatedCharge.toFixed(2)}`);
                            
                            // Use LOWER price
                            if (calculatedCharge < originalMileageCharge) {
                                newMileageCharge = calculatedCharge;
                                newMileageDistance = calculatedMiles;
                                newMileageExplanation = `New address - lower rate (${calculatedMiles.toFixed(2)} mi @ $${newMileageRate.toFixed(2)}/mi)`;
                            } else {
                                newMileageCharge = originalMileageCharge;
                                newMileageDistance = originalTotalMiles;
                                newMileageExplanation = `Original rate preserved (${originalTotalMiles.toFixed(2)} mi @ $${originalMileageRate.toFixed(2)}/mi)`;
                            }
                        } catch (err) {
                            console.error('[ReschedulePricing] New mileage calc failed:', err);
                            // Fallback to original
                            newMileageCharge = originalMileageCharge;
                            newMileageDistance = originalTotalMiles;
                            newMileageExplanation = `Using original rate (calc error)`;
                        }
                    }
                }

                // Process new add-ons
                const addonsMap = new Map();
                if (Array.isArray(newAddonsList)) {
                    newAddonsList.forEach(addon => {
                        const name = addon?.name || 'Unknown';
                        const key = name.toLowerCase();
                        if (!addonsMap.has(key)) {
                            addonsMap.set(key, {
                                name: name,
                                quantity: Number(addon?.quantity) || 1,
                                unitPrice: Number(addon?.price) || 0,
                                total: (Number(addon?.price) || 0) * (Number(addon?.quantity) || 1)
                            });
                        }
                    });
                }
                const newAddons = Array.from(addonsMap.values());
                const newAddonsTotal = newAddons.reduce((sum, a) => sum + a.total, 0);

                const newSubtotal = newBaseRentalCost + newDeliveryFeeApplied + newMileageCharge + newAddonsTotal;
                const newTax = newSubtotal * 0.07;
                const newTotal = newSubtotal + newTax;

                const newCostsData = {
                    baseRentalCost: newBaseRentalCost,
                    deliveryFee: newDeliveryFeeApplied,
                    mileageCharge: newMileageCharge,
                    mileageDistance: newMileageDistance,
                    mileageRate: newMileageRate,
                    addons: newAddons,
                    addonsTotal: newAddonsTotal,
                    subtotal: newSubtotal,
                    tax: newTax,
                    total: newTotal,
                    days: newDays
                };

                console.log('[ReschedulePricing] New costs calculated:', newCostsData);
                if (!isMounted) return;
                setNewCosts(newCostsData);

                setMileageLogic({
                    isSameAddress,
                    explanation: newMileageExplanation,
                    isManualAddress
                });

                console.log('[ReschedulePricing] All calculations complete successfully!');
                
            } catch (err) {
                console.error('[ReschedulePricing] Calculation error:', err);
                if (isMounted) {
                    setError(err.message || 'Failed to calculate pricing');
                }
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
                if (isMounted) {
                    console.log('[ReschedulePricing] Setting loading to false');
                    setLoading(false);
                }
            }
        };

        performAllCalculations();

        return () => {
            isMounted = false;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [bookingId, originalService, newService, newAddonsList, newDropOffDate, newPickupDate, distanceMiles, isManualAddress, retryCount]);

    const handleRetry = () => {
        setRetryCount(prev => prev + 1);
    };

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <AlertCircle className="h-12 w-12 text-red-500" />
                <p className="text-red-400 text-lg font-semibold">Calculation Error</p>
                <p className="text-gray-400 text-sm max-w-md text-center">{error}</p>
                <Button onClick={handleRetry} variant="outline" className="mt-4">
                    <RefreshCw className="mr-2 h-4 w-4" /> Retry Calculation
                </Button>
            </div>
        );
    }

    if (loading || !newCosts || !originalDetailedCosts) {
        return (
            <div className="flex flex-col items-center justify-center py-32 space-y-5 h-full">
                <Loader2 className="h-12 w-12 animate-spin text-gold" />
                <p className="text-gray-400 text-base font-medium tracking-wide animate-pulse">Calculating pricing...</p>
                <p className="text-gray-600 text-xs">Using stored mileage data</p>
            </div>
        );
    }

    const difference = newCosts.total - originalDetailedCosts.total;
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
                <Card className="bg-gray-900/60 border-gray-800 shadow-xl rounded-2xl h-full flex flex-col relative">
                    <div className="absolute top-4 left-4 z-10">
                        <span className="bg-gray-800/90 text-gray-400 text-[10px] font-bold px-3 py-1.5 rounded-full border border-gray-700">
                            ORIGINAL
                        </span>
                    </div>
                    <CardContent className="p-8 pt-16 flex flex-col h-full">
                        <div className="space-y-4 flex-1 text-base">
                            <div className="flex justify-between items-center text-gray-300">
                                <span>Base Rental <span className="text-xs text-gray-500 ml-2">({originalService?.name} - {originalDetailedCosts.days} days)</span></span>
                                <span className="font-bold">{formatCurrency(originalDetailedCosts.baseRentalCost * 100, currencyInfo)}</span>
                            </div>
                            
                            {originalDetailedCosts.deliveryFee > 0 && (
                                <div className="flex justify-between items-center text-gray-300">
                                    <span>Delivery Fee (Flat)</span>
                                    <span className="font-bold">{formatCurrency(originalDetailedCosts.deliveryFee * 100, currencyInfo)}</span>
                                </div>
                            )}

                            {originalDetailedCosts.mileageCharge > 0 && (
                                <div className="bg-gray-950 p-3 rounded-lg border border-gray-800">
                                    <div className="flex justify-between items-center text-gray-300">
                                        <span className="font-semibold">Mileage Charge</span>
                                        <span className="font-bold">{formatCurrency(originalDetailedCosts.mileageCharge * 100, currencyInfo)}</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {originalDetailedCosts.mileageDistance.toFixed(2)} miles (complete route) @ ${originalDetailedCosts.mileageRate.toFixed(2)}/mile
                                    </p>
                                </div>
                            )}
                            
                            {originalDetailedCosts.addons.length > 0 && (
                                <div className="pl-5 border-l-2 border-gray-800 space-y-2.5 py-2">
                                    <span className="text-xs font-black text-gray-600 uppercase tracking-widest block mb-2">Add-ons & Equipment</span>
                                    {originalDetailedCosts.addons.map((addon, idx) => (
                                        <div key={`orig-addon-${idx}`} className="space-y-1">
                                            <div className="flex justify-between text-sm text-gray-300">
                                                <span className="font-medium">{addon.name}</span>
                                                <span className="font-bold">{formatCurrency(addon.total * 100, currencyInfo)}</span>
                                            </div>
                                            <p className="text-xs text-gray-500">
                                                Qty: {addon.quantity} @ {formatCurrency(addon.unitPrice * 100, currencyInfo)} each
                                            </p>
                                        </div>
                                    ))}
                                    <div className="flex justify-between text-sm text-gray-400 pt-2 border-t border-gray-800/50">
                                        <span>Add-ons Subtotal</span>
                                        <span>{formatCurrency(originalDetailedCosts.addonsTotal * 100, currencyInfo)}</span>
                                    </div>
                                </div>
                            )}
                            
                            <div className="flex justify-between items-center text-gray-300 mt-4 pt-4 border-t border-gray-800/50">
                                <span>Subtotal</span>
                                <span className="font-bold">{formatCurrency(originalDetailedCosts.subtotal * 100, currencyInfo)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center text-gray-400">
                                <span>Estimated Tax (7%)</span>
                                <span>{formatCurrency(originalDetailedCosts.tax * 100, currencyInfo)}</span>
                            </div>
                        </div>

                        <div className="bg-gray-950 p-5 rounded-xl border border-gray-800 mt-8">
                            <div className="flex justify-between items-center">
                                <span className="text-gray-400 font-black text-xs uppercase tracking-widest">Original Total</span>
                                <span className="text-2xl font-black text-gray-200">
                                    {formatCurrency(originalDetailedCosts.total * 100, currencyInfo)}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* New Costs Card */}
                <Card className="bg-[hsl(var(--gold)_/_0.03)] border-[hsl(var(--gold)_/_0.3)] shadow-[0_0_30px_hsla(var(--gold),0.05)] rounded-2xl relative overflow-hidden h-full flex flex-col">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-gold to-gold-light"></div>
                    <div className="absolute top-4 left-4 z-10">
                        <span className="bg-gold/20 text-gold text-[10px] font-bold px-3 py-1.5 rounded-full border border-gold/40">
                            NEW REQUEST
                        </span>
                    </div>
                    <CardContent className="p-8 pt-16 flex flex-col h-full">
                        <div className="space-y-4 flex-1 text-base">
                            <div className="flex justify-between items-center text-white">
                                <span>Base Rental <span className="text-xs text-gold-light/60 ml-2">({newService?.name} - {newCosts.days} days)</span></span>
                                <span className="font-bold">{formatCurrency(newCosts.baseRentalCost * 100, currencyInfo)}</span>
                            </div>
                            
                            {newCosts.deliveryFee > 0 && (
                                <div className="flex justify-between items-center text-white">
                                    <span>Delivery Fee (Flat)</span>
                                    <span className="font-bold">{formatCurrency(newCosts.deliveryFee * 100, currencyInfo)}</span>
                                </div>
                            )}

                            {mileageLogic && (
                                <div className={`p-3 rounded-lg border ${
                                    mileageLogic.isSameAddress 
                                        ? 'bg-blue-950/30 border-blue-500/30' 
                                        : mileageLogic.isManualAddress 
                                            ? 'bg-orange-950/30 border-orange-500/30'
                                            : 'bg-green-950/30 border-green-500/30'
                                }`}>
                                    <div className="flex justify-between items-center text-white">
                                        <span className="font-semibold flex items-center gap-2">
                                            {mileageLogic.isSameAddress && <Lock className="w-4 h-4" />}
                                            {!mileageLogic.isSameAddress && !mileageLogic.isManualAddress && <RefreshCw className="w-4 h-4" />}
                                            Mileage Charge
                                        </span>
                                        <span className="font-bold">
                                            {mileageLogic.isManualAddress ? 'Pending' : formatCurrency(newCosts.mileageCharge * 100, currencyInfo)}
                                        </span>
                                    </div>
                                    <p className={`text-xs mt-1 ${
                                        mileageLogic.isSameAddress ? 'text-blue-300' : 
                                        mileageLogic.isManualAddress ? 'text-orange-300' : 
                                        'text-green-300'
                                    }`}>
                                        {mileageLogic.explanation}
                                    </p>
                                </div>
                            )}
                            
                            {newCosts.addons.length > 0 && (
                                <div className="pl-5 border-l-2 border-gold/30 space-y-2.5 py-2">
                                    <span className="text-xs font-black text-gold-light uppercase tracking-widest block mb-2">Selected Add-ons</span>
                                    {newCosts.addons.map((addon, idx) => (
                                        <div key={`new-addon-${idx}`} className="space-y-1">
                                            <div className="flex justify-between text-sm text-white">
                                                <span className="font-medium">{addon.name}</span>
                                                <span className="font-bold">{formatCurrency(addon.total * 100, currencyInfo)}</span>
                                            </div>
                                            <p className="text-xs text-gray-400">
                                                Qty: {addon.quantity} @ {formatCurrency(addon.unitPrice * 100, currencyInfo)} each
                                            </p>
                                        </div>
                                    ))}
                                    <div className="flex justify-between text-sm text-gray-300 pt-2 border-t border-gold/20">
                                        <span>Add-ons Subtotal</span>
                                        <span>{formatCurrency(newCosts.addonsTotal * 100, currencyInfo)}</span>
                                    </div>
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
            {mileageLogic?.isManualAddress && (
                <Card className="bg-orange-950/20 border-orange-500/30">
                    <CardContent className="p-6">
                        <div className="flex items-start gap-4">
                            <AlertCircle className="w-6 h-6 text-orange-400 flex-shrink-0 mt-1" />
                            <div>
                                <h4 className="text-orange-300 font-bold text-base mb-2">Manual Address Review</h4>
                                <p className="text-orange-200/80 text-sm leading-relaxed">
                                    This address will be manually reviewed. Complete route mileage will be calculated upon approval.
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
                    <p className="text-sm text-gray-400 max-w-md">Price difference after admin approval. Rescheduling fees assessed at final approval.</p>
                </div>
                <div className="flex items-center gap-4 bg-gray-950 px-6 py-4 rounded-xl border border-gray-800">
                    <div className="hidden sm:flex flex-col items-end mr-2">
                        <span className="text-xs font-bold text-gray-500 uppercase">Original</span>
                        <span className="text-sm font-medium text-gray-400 line-through">{formatCurrency(originalDetailedCosts.total * 100, currencyInfo)}</span>
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