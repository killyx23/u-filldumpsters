import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Mail, ShieldCheck, Loader2, CheckCircle2, Calendar, MapPin, Package, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { format, isValid } from 'date-fns';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';
import { PriceBreakdownCategory } from '@/components/pricing/PriceBreakdownCategory';
import { formatTimeWindow, shouldShowTimeWindow } from '@/utils/timeWindowFormatter';
import { getServiceSpecificDateLabel, isSelfServiceTrailer } from '@/utils/serviceSpecificLabels';
import { getFormattedServiceTimes } from '@/utils/serviceAvailabilityHelper';
import { useTaxRate } from '@/utils/getTaxRate';
import { calculateTotalWithTax } from '@/utils/calculateTaxAmount';

export const VerifyEmailBeforeBooking = ({ bookingData, addonsData, plan, totalPrice, onBack, onComplete, isProcessing }) => {
    const [status, setStatus] = useState('initial');
    const [code, setCode] = useState('');
    const [equipmentPrices, setEquipmentPrices] = useState({});
    const [loadingPrices, setLoadingPrices] = useState(true);
    const [availabilityTimes, setAvailabilityTimes] = useState({
        pickupStartTime: 'Time not specified',
        returnByTime: 'Time not specified'
    });

    const isDelivery = plan?.id === 2 && addonsData?.deliveryService;
    const { taxRate, loading: loadingTaxRate } = useTaxRate();

    // Load equipment prices from database
    useEffect(() => {
        const loadPrices = async () => {
            setLoadingPrices(true);
            const prices = {};

            try {
                // Load all equipment prices (IDs 1-7)
                for (let id = 1; id <= 7; id++) {
                    if (isValidEquipmentId(id)) {
                        prices[id] = await getPriceForEquipment(id);
                    }
                }
                setEquipmentPrices(prices);
            } catch (error) {
                console.error('[VerifyEmailBeforeBooking] Error loading prices:', error);
            } finally {
                setLoadingPrices(false);
            }
        };

        loadPrices();
    }, []);

    // Load availability times for Dump Loader Trailer (plan.id === 2) without delivery
    useEffect(() => {
        const loadAvailabilityTimes = async () => {
            // Only fetch for self-service Dump Loader Trailer (plan.id === 2 without delivery)
            if (plan?.id === 2 && !isDelivery) {
                try {
                    const dropOffDate = bookingData?.dropOffDate;
                    const pickupDate = bookingData?.pickupDate;

                    if (dropOffDate) {
                        const dropOffTimes = await getFormattedServiceTimes(2, dropOffDate);
                        const pickupTimes = pickupDate 
                            ? await getFormattedServiceTimes(2, pickupDate)
                            : dropOffTimes;

                        setAvailabilityTimes({
                            pickupStartTime: dropOffTimes.pickupStartTime,
                            returnByTime: pickupTimes.returnByTime
                        });
                    }
                } catch (error) {
                    console.error('[VerifyEmailBeforeBooking] Error loading availability times:', error);
                }
            }
        };

        loadAvailabilityTimes();
    }, [plan?.id, isDelivery, bookingData?.dropOffDate, bookingData?.pickupDate]);

    const handleSendCode = async () => {
        setStatus('sending');
        try {
            const { data, error } = await supabase.functions.invoke('send-verification-email', {
                body: { email: bookingData.email, name: `${bookingData.firstName} ${bookingData.lastName}`.trim() }
            });
            if (error) {
              const errData = await error.context?.json().catch(()=>null);
              throw new Error(errData?.error || error.message);
            }
            setStatus('sent');
            toast({ title: 'Code Sent', description: `We sent a verification code to ${bookingData.email}.` });
        } catch (err) {
            console.error("[VerifyEmailBeforeBooking] Send error:", err);
            setStatus('initial');
            toast({ title: 'Failed to send code', description: err.message || 'An error occurred.', variant: 'destructive' });
        }
    };

    const handleVerify = async () => {
        if (!code || code.length < 5) return;
        setStatus('verifying');
        try {
            const { data, error } = await supabase.functions.invoke('verify-email-code', {
                body: { email: bookingData.email, code }
            });
            if (error) {
              const errData = await error.context?.json().catch(()=>null);
              throw new Error(errData?.error || error.message);
            }
            if (!data.success) throw new Error(data.error || 'Invalid code');
            
            setStatus('verified');
            onComplete();
        } catch (err) {
            console.error("[VerifyEmailBeforeBooking] Verify error:", err);
            setStatus('sent');
            toast({ title: 'Verification Failed', description: err.message || 'Invalid or expired code.', variant: 'destructive' });
        }
    };

    // Time window formatting options
    const showTimeWindow = shouldShowTimeWindow(plan, isDelivery);
    const isSelfService = isSelfServiceTrailer(plan, isDelivery);
    const timeOptions = {
        isWindow: showTimeWindow,
        isSelfService: isSelfService,
        serviceType: plan?.service_type
    };

    // Get service-specific labels
    const dropoffLabel = getServiceSpecificDateLabel(plan, isDelivery, 'dropoff');
    const pickupLabel = getServiceSpecificDateLabel(plan, isDelivery, 'pickup');

    // Format times based on whether this is self-service Dump Loader Trailer
    const getDisplayTime = (timeSlot, isDropOff) => {
        // For self-service Dump Loader Trailer (plan.id === 2 without delivery)
        if (plan?.id === 2 && !isDelivery) {
            return isDropOff ? availabilityTimes.pickupStartTime : availabilityTimes.returnByTime;
        }
        // For all other services, use the standard formatTimeWindow
        return formatTimeWindow(timeSlot, timeOptions);
    };

    // Calculate breakdown using the 8-category format with dynamic tax
    const calculatedTotals = useMemo(() => {
        const basePriceAmount = plan?.price || plan?.base_price || 0;
        const deliveryFeeFlat = addonsData?.deliveryFee || 0;
        const tripMileageCost = addonsData?.mileageCharge || 0;
        
        // Protection costs
        const insuranceCost = addonsData?.insurance === 'accept' ? Number(equipmentPrices[7] || 20) : 0;
        const drivewayProtectionCost = (plan?.id === 1 || isDelivery) && addonsData?.drivewayProtection === 'accept' ? 15 : 0;

        // Equipment costs
        let rentEquipmentCost = 0;
        let purchaseItemsCost = 0;

        if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
            addonsData.equipment.forEach(item => {
                const equipmentId = item.equipment_id || item.dbId || item.id;
                if (!equipmentId || !isValidEquipmentId(equipmentId)) return;

                const price = Number(equipmentPrices[equipmentId] || 0);
                const quantity = Number(item.quantity || 1);
                const itemTotal = price * quantity;

                // ID 3 is Working Gloves (purchase item)
                if (equipmentId === 3) {
                    purchaseItemsCost += itemTotal;
                } else {
                    rentEquipmentCost += itemTotal;
                }
            });
        }

        // Disposal costs
        let disposalCost = 0;
        if (addonsData?.mattressDisposal && addonsData.mattressDisposal > 0) {
            disposalCost += Number(equipmentPrices[4] || 25) * addonsData.mattressDisposal;
        }
        if (addonsData?.tvDisposal && addonsData.tvDisposal > 0) {
            disposalCost += Number(equipmentPrices[5] || 15) * addonsData.tvDisposal;
        }
        if (addonsData?.applianceDisposal && addonsData.applianceDisposal > 0) {
            disposalCost += Number(equipmentPrices[6] || 35) * addonsData.applianceDisposal;
        }

        // Subtotal before discount
        const subtotalBeforeDiscount = basePriceAmount + deliveryFeeFlat + tripMileageCost + 
                                        insuranceCost + drivewayProtectionCost + 
                                        rentEquipmentCost + purchaseItemsCost + disposalCost;

        // Discount
        let discount = 0;
        if (addonsData?.coupon?.isValid) {
            if (addonsData.coupon.discountType === 'fixed') {
                discount = Number(addonsData.coupon.discountValue || 0);
            } else if (addonsData.coupon.discountType === 'percentage') {
                discount = (subtotalBeforeDiscount * Number(addonsData.coupon.discountValue || 0)) / 100;
            }
        }

        const subtotal = Math.max(0, subtotalBeforeDiscount - discount);
        
        // Use dynamic tax rate
        const taxCalc = calculateTotalWithTax(subtotal, taxRate);

        return {
            basePriceAmount,
            deliveryFeeFlat,
            tripMileageCost,
            insuranceCost,
            drivewayProtectionCost,
            rentEquipmentCost,
            purchaseItemsCost,
            disposalCost,
            discount,
            subtotal: taxCalc.subtotal,
            tax: taxCalc.tax,
            taxRate: taxRate,
            total: taxCalc.total
        };
    }, [plan, addonsData, equipmentPrices, isDelivery, taxRate]);

    // Prepare category items
    const serviceItems = [];
    if (calculatedTotals.basePriceAmount > 0) {
        serviceItems.push({ label: 'Base Rental', amount: calculatedTotals.basePriceAmount });
    }
    if (calculatedTotals.deliveryFeeFlat > 0) {
        serviceItems.push({ label: 'Base Delivery Fee', amount: calculatedTotals.deliveryFeeFlat });
    }
    if (calculatedTotals.tripMileageCost > 0) {
        serviceItems.push({ 
            label: 'Mileage Charge', 
            amount: calculatedTotals.tripMileageCost,
            sublabel: addonsData?.distanceFeeDisplay 
        });
    }

    const protectionItems = [];
    if (calculatedTotals.insuranceCost > 0) {
        protectionItems.push({ label: 'Rental Insurance', amount: calculatedTotals.insuranceCost });
    }
    if (calculatedTotals.drivewayProtectionCost > 0) {
        protectionItems.push({ label: 'Driveway Protection', amount: calculatedTotals.drivewayProtectionCost });
    }

    const rentEquipmentItems = [];
    if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
        addonsData.equipment.forEach(item => {
            const equipmentId = item.equipment_id || item.dbId || item.id;
            if (!equipmentId || !isValidEquipmentId(equipmentId) || equipmentId === 3) return;
            
            const price = Number(equipmentPrices[equipmentId] || 0);
            const quantity = Number(item.quantity || 1);
            const itemName = equipmentId === 1 ? 'Wheelbarrow' : equipmentId === 2 ? 'Hand Truck' : `Equipment #${equipmentId}`;
            
            rentEquipmentItems.push({ 
                label: `${itemName} (x${quantity})`, 
                amount: price * quantity 
            });
        });
    }

    const purchaseItems = [];
    if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
        const glovesItem = addonsData.equipment.find(item => {
            const id = item.equipment_id || item.dbId || item.id;
            return id === 3;
        });
        
        if (glovesItem) {
            const price = Number(equipmentPrices[3] || 0);
            const quantity = Number(glovesItem.quantity || 1);
            purchaseItems.push({ 
                label: `Working Gloves (Pair) (x${quantity})`, 
                amount: price * quantity 
            });
        }
    }

    const disposalItems = [];
    if (addonsData?.mattressDisposal && addonsData.mattressDisposal > 0) {
        const price = Number(equipmentPrices[4] || 25);
        disposalItems.push({ 
            label: `Mattress Disposal (x${addonsData.mattressDisposal})`, 
            amount: price * addonsData.mattressDisposal 
        });
    }
    if (addonsData?.tvDisposal && addonsData.tvDisposal > 0) {
        const price = Number(equipmentPrices[5] || 15);
        disposalItems.push({ 
            label: `TV Disposal (x${addonsData.tvDisposal})`, 
            amount: price * addonsData.tvDisposal 
        });
    }
    if (addonsData?.applianceDisposal && addonsData.applianceDisposal > 0) {
        const price = Number(equipmentPrices[6] || 35);
        disposalItems.push({ 
            label: `Appliance Disposal (x${addonsData.applianceDisposal})`, 
            amount: price * addonsData.applianceDisposal 
        });
    }

    const discountItems = [];
    if (calculatedTotals.discount > 0) {
        discountItems.push({ 
            label: `Coupon (${addonsData.coupon?.code || 'Applied'})`, 
            amount: -calculatedTotals.discount, 
            highlight: true 
        });
    }

    if (loadingPrices || loadingTaxRate) {
        return (
            <div className="container mx-auto py-16 px-4">
                <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
                        <span className="ml-3 text-white">Loading price breakdown...</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="container mx-auto py-16 px-4"
        >
            <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                <div className="flex items-center mb-8 border-b border-white/10 pb-4">
                    <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20" disabled={isProcessing || status === 'verifying'}>
                        <ArrowLeft />
                    </Button>
                    <h2 className="text-3xl font-bold text-white flex items-center">
                        <ShieldCheck className="mr-3 h-8 w-8 text-yellow-400" />
                        Verify Email
                    </h2>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                    {/* Summary Section */}
                    <div className="bg-black/20 p-6 rounded-xl border border-white/10 space-y-4 text-sm">
                        <h3 className="text-lg font-bold text-yellow-400 border-b border-white/10 pb-2 mb-4 flex items-center">
                            <Receipt className="h-5 w-5 mr-2" /> Booking Summary
                        </h3>
                        
                        <div className="flex items-start text-gray-200">
                            <Package className="h-5 w-5 mr-3 text-blue-400 mt-0.5" />
                            <div>
                                <p className="font-semibold text-white">{plan?.name || 'Selected Plan'}</p>
                                {addonsData?.equipment?.length > 0 && <p className="text-gray-400">+ {addonsData.equipment.length} Add-on(s)</p>}
                            </div>
                        </div>

                        <div className="flex items-start text-gray-200">
                            <Calendar className="h-5 w-5 mr-3 text-green-400 mt-0.5" />
                            <div>
                                <p><span className="text-white">{dropoffLabel}:</span> {bookingData.dropOffDate ? format(new Date(bookingData.dropOffDate), 'MMM d, yyyy') : 'N/A'}</p>
                                {isSelfService && <p className="text-xs">Pickup Start Time: {getDisplayTime(bookingData.dropOffTimeSlot, true)}</p>}
                                {!isSelfService && <p className="text-xs">{getDisplayTime(bookingData.dropOffTimeSlot, true)}</p>}
                                {bookingData.pickupDate && (
                                    <>
                                        <p className="mt-1"><span className="text-white">{pickupLabel}:</span> {format(new Date(bookingData.pickupDate), 'MMM d, yyyy')}</p>
                                        {isSelfService && <p className="text-xs">Return by Time: {getDisplayTime(bookingData.pickupTimeSlot, false)}</p>}
                                        {!isSelfService && <p className="text-xs">{getDisplayTime(bookingData.pickupTimeSlot, false)}</p>}
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="flex items-start text-gray-200">
                            <MapPin className="h-5 w-5 mr-3 text-red-400 mt-0.5" />
                            <div>
                                <p>{bookingData.street || addonsData?.deliveryAddress?.street}</p>
                                <p>{bookingData.city || addonsData?.deliveryAddress?.city}, {bookingData.state || addonsData?.deliveryAddress?.state} {bookingData.zip || addonsData?.deliveryAddress?.zip}</p>
                            </div>
                        </div>

                        {/* Cost Breakdown */}
                        <div className="mt-6 pt-4 border-t border-white/10 space-y-2">
                            <h4 className="text-white font-semibold mb-3">Cost Breakdown</h4>
                            
                            <div className="max-h-[40vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent space-y-2">
                                {/* 1. Service Costs */}
                                <PriceBreakdownCategory
                                    icon="📦"
                                    title="Service Costs"
                                    items={serviceItems}
                                    compact={true}
                                />

                                {/* 2. Protection Options */}
                                {protectionItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="🛡️"
                                        title="Protection"
                                        items={protectionItems}
                                        compact={true}
                                    />
                                )}

                                {/* 3. Rent Equipment */}
                                {rentEquipmentItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="🚚"
                                        title="Rent Equipment"
                                        items={rentEquipmentItems}
                                        compact={true}
                                    />
                                )}

                                {/* 4. Items for Purchase */}
                                {purchaseItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="🛒"
                                        title="Purchase Items"
                                        items={purchaseItems}
                                        compact={true}
                                    />
                                )}

                                {/* 5. Disposal Items */}
                                {disposalItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="♻️"
                                        title="Disposal"
                                        items={disposalItems}
                                        compact={true}
                                    />
                                )}

                                {/* 6. Discounts */}
                                {discountItems.length > 0 && (
                                    <PriceBreakdownCategory
                                        icon="🏷️"
                                        title="Discounts"
                                        items={discountItems}
                                        compact={true}
                                    />
                                )}
                            </div>

                            {/* 7. Totals */}
                            <div className="border-t border-white/20 pt-3 mt-3 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-blue-200 font-semibold">Subtotal:</span>
                                    <span className="text-white font-bold">${calculatedTotals.subtotal.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-blue-200 font-semibold">Tax ({calculatedTotals.taxRate.toFixed(2)}%):</span>
                                    <span className="text-white font-bold">${calculatedTotals.tax.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-base pt-2 border-t border-white/10">
                                    <span className="font-bold text-white">Total:</span>
                                    <span className="font-bold text-green-400">${calculatedTotals.total.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Verification Section */}
                    <div className="flex flex-col justify-center space-y-6">
                        <div className="text-center">
                            <Mail className="mx-auto h-12 w-12 text-blue-400 mb-4" />
                            <h3 className="text-xl font-bold text-white mb-2">Verify Your Email</h3>
                            <p className="text-gray-300 text-sm">
                                We need to verify <strong className="text-yellow-300">{bookingData.email}</strong> to secure your booking and send your receipt.
                            </p>
                        </div>

                        <AnimatePresence mode="wait">
                            {status === 'initial' && (
                                <motion.div key="initial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                    <Button onClick={handleSendCode} className="w-full py-6 text-lg font-bold bg-blue-600 hover:bg-blue-700 text-white">
                                        Send Verification Code
                                    </Button>
                                </motion.div>
                            )}

                            {(status === 'sending' || status === 'verifying' || isProcessing) && status !== 'verified' && (
                                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center p-6 text-yellow-400">
                                    <Loader2 className="h-10 w-10 animate-spin mb-4" />
                                    <p className="font-semibold text-white">
                                        {status === 'sending' ? 'Sending code to your email...' : 
                                         status === 'verifying' ? 'Verifying your code...' : 'Preparing secure payment...'}
                                    </p>
                                </motion.div>
                            )}

                            {status === 'sent' && (
                                <motion.div key="sent" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                                    <div className="bg-black/30 p-4 rounded-lg border border-blue-500/30">
                                        <p className="text-sm text-blue-200 mb-3 text-center">Enter the 6-digit code sent to your email</p>
                                        <Input
                                            type="text"
                                            maxLength={6}
                                            placeholder="123456"
                                            value={code}
                                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                            className="text-center text-2xl tracking-[0.5em] h-14 bg-white/10 border-white/30 text-white font-mono placeholder:text-gray-500"
                                        />
                                    </div>
                                    
                                    <Button onClick={handleVerify} disabled={code.length < 5} className="w-full py-6 text-lg font-bold bg-green-600 hover:bg-green-700 text-white">
                                        Verify & Complete
                                    </Button>
                                    
                                    <div className="text-center mt-2">
                                        <Button variant="link" onClick={handleSendCode} className="text-gray-400 hover:text-white text-sm">
                                            Didn't receive a code? Resend
                                        </Button>
                                    </div>
                                </motion.div>
                            )}

                            {status === 'verified' && isProcessing && (
                                <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center p-6">
                                    <CheckCircle2 className="h-12 w-12 text-green-400 mb-4" />
                                    <h3 className="text-xl font-bold text-white mb-2">Email Verified!</h3>
                                    <p className="text-gray-300 text-center flex items-center">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Preparing secure payment...
                                    </p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};