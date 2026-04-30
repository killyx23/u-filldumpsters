import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO, isValid } from 'date-fns';
import { PriceBreakdownCategory } from '@/components/pricing/PriceBreakdownCategory';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';
import { formatTimeWindow, shouldShowTimeWindow } from '@/utils/timeWindowFormatter';
import { getServiceSpecificDateLabel, isSelfServiceTrailer } from '@/utils/serviceSpecificLabels';
import { getFormattedServiceTimes } from '@/utils/serviceAvailabilityHelper';
import { useTaxRate } from '@/utils/getTaxRate';
import { calculateTaxAmount, calculateTotalWithTax } from '@/utils/calculateTaxAmount';

export const BookingSummaryReview = ({
    bookingData,
    plan,
    addonsData,
    totalPrice,
    basePrice,
    onBack,
    onContinue,
    deliveryService
}) => {
    const isDelivery = plan?.id === 2 && deliveryService;
    const [equipmentPrices, setEquipmentPrices] = useState({});
    const [loading, setLoading] = useState(true);
    const [availabilityTimes, setAvailabilityTimes] = useState({
        pickupStartTime: 'Time not specified',
        returnByTime: 'Time not specified'
    });

    const { taxRate, loading: loadingTaxRate } = useTaxRate();

    // Load equipment prices from database
    useEffect(() => {
        const loadPrices = async () => {
            setLoading(true);
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
                console.error('[BookingSummaryReview] Error loading prices:', error);
            } finally {
                setLoading(false);
            }
        };

        loadPrices();
    }, []);

    // Load availability times for Dump Loader Trailer (plan.id === 2) without delivery
    useEffect(() => {
        const loadAvailabilityTimes = async () => {
            // Only fetch for self-service Dump Loader Trailer (plan.id === 2 without delivery)
            if (plan?.id === 2 && !deliveryService) {
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
                    console.error('[BookingSummaryReview] Error loading availability times:', error);
                }
            }
        };

        loadAvailabilityTimes();
    }, [plan?.id, deliveryService, bookingData?.dropOffDate, bookingData?.pickupDate]);

    const formatDate = date => {
        if (!date) return 'N/A';
        try {
            const parsedDate = date instanceof Date ? date : parseISO(date.toString());
            if (!isValid(parsedDate)) return "Invalid Date";
            return format(parsedDate, 'MMM d, yyyy');
        } catch (e) {
            return "Invalid Date";
        }
    };

    const calculatedTotals = useMemo(() => {
        const basePriceAmount = plan?.price !== undefined ? plan.price : (basePrice || 0);
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
        
        // Use dynamic tax rate from database
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
    }, [basePrice, plan, addonsData, equipmentPrices, isDelivery, taxRate]);

    const planName = plan?.name || 'Selected Plan';
    const displayPlanName = isDelivery ? `${planName} (with Delivery)` : planName;

    const contactAddress = bookingData?.contactAddress || {};
    
    const isDumpsterService = plan?.id === 2 && !deliveryService;
    const displayLocation = isDumpsterService 
        ? "South Saratoga Springs" 
        : (contactAddress.city || bookingData?.city || 'City not provided');

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
        if (plan?.id === 2 && !deliveryService) {
            return isDropOff ? availabilityTimes.pickupStartTime : availabilityTimes.returnByTime;
        }
        // For all other services, use the standard formatTimeWindow
        return formatTimeWindow(timeSlot, timeOptions);
    };

    if (loading || loadingTaxRate) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="text-white">Loading price breakdown...</div>
            </div>
        );
    }

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

    const isDeliveryServiceForFees = plan?.id === 1 || plan?.id === 4 || (plan?.id === 2 && deliveryService);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="container mx-auto py-12 px-4"
        >
            <div className="max-w-3xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                <div className="flex items-center mb-8 border-b border-white/10 pb-4">
                    <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20">
                        <ArrowLeft />
                    </Button>
                    <h2 className="text-3xl font-bold text-white flex items-center">
                        <CheckCircle2 className="mr-3 h-8 w-8 text-green-400" />
                        Booking Summary Review
                    </h2>
                </div>

                <div className="space-y-6">
                    <div className="bg-black/20 p-6 rounded-xl border border-white/10">
                        <h3 className="text-xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2">Service Details</h3>
                        <div className="grid md:grid-cols-2 gap-4 text-gray-200">
                            <div>
                                <p className="text-sm text-gray-400">Selected Plan</p>
                                <p className="font-semibold text-white text-lg">{displayPlanName}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Location</p>
                                <p className="font-semibold text-white text-lg">{displayLocation}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">{dropoffLabel}</p>
                                <p className="font-semibold text-white">{formatDate(bookingData?.dropOffDate)}</p>
                                {isSelfService && <p className="text-sm">Pickup Start Time: {getDisplayTime(bookingData?.dropOffTimeSlot, true)}</p>}
                                {!isSelfService && <p className="text-sm">{getDisplayTime(bookingData?.dropOffTimeSlot, true)}</p>}
                            </div>
                            {bookingData?.pickupDate && (
                                <div>
                                    <p className="text-sm text-gray-400">{pickupLabel}</p>
                                    <p className="font-semibold text-white">{formatDate(bookingData.pickupDate)}</p>
                                    {isSelfService && <p className="text-sm">Return by Time: {getDisplayTime(bookingData.pickupTimeSlot, false)}</p>}
                                    {!isSelfService && <p className="text-sm">{getDisplayTime(bookingData.pickupTimeSlot, false)}</p>}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-black/20 p-6 rounded-xl border border-white/10">
                        <h3 className="text-xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2">Price Breakdown</h3>
                        
                        <div className="max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
                            {/* 1. Service Costs */}
                            <PriceBreakdownCategory
                                icon="📦"
                                title="Service Costs"
                                items={serviceItems}
                            />

                            {/* 2. Protection Options - NOW WITH SERVICE NAME */}
                            <PriceBreakdownCategory
                                icon="🛡️"
                                title="Protection Options"
                                items={protectionItems}
                                showInfoButton={true}
                                infoTitle="Protection Options"
                                infoDescription="Insurance covers damage to the rental equipment. Driveway protection prevents damage to your property during delivery."
                                serviceName={plan?.name}
                            />

                            {/* 3. Rent Equipment */}
                            <PriceBreakdownCategory
                                icon="🚚"
                                title="Rent Equipment"
                                items={rentEquipmentItems}
                            />

                            {/* 4. Items for Purchase */}
                            <PriceBreakdownCategory
                                icon="🛒"
                                title="Items for Purchase"
                                items={purchaseItems}
                            />

                            {/* 5. Disposal Items */}
                            <PriceBreakdownCategory
                                icon="♻️"
                                title="Disposal Items"
                                items={disposalItems}
                                showInfoButton={true}
                                infoTitle="Disposal Items"
                                infoDescription="Special disposal fees for materials that require certified waste facility processing (mattresses, TVs, appliances)."
                            />

                            {/* 6. Discounts */}
                            <PriceBreakdownCategory
                                icon="🏷️"
                                title="Discounts"
                                items={discountItems}
                            />

                            {/* 7. Totals */}
                            <div className="border-t border-white/20 pt-4 space-y-2 mt-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-blue-200 font-semibold">Subtotal</span>
                                    <span className="text-white font-bold">${calculatedTotals.subtotal.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-blue-200 font-semibold">Tax ({calculatedTotals.taxRate.toFixed(2)}%)</span>
                                    <span className="text-white font-bold">${calculatedTotals.tax.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center text-lg pt-2 border-t border-white/10">
                                    <span className="text-white font-bold">Total</span>
                                    <span className="text-green-400 font-bold">${calculatedTotals.total.toFixed(2)}</span>
                                </div>
                            </div>

                            {/* 8. Landfill/Disposal Fees */}
                            {isDeliveryServiceForFees && (
                                <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3 mt-4">
                                    <div className="flex items-start">
                                        <span className="text-xl mr-2">🏗️</span>
                                        <div className="flex-1">
                                            <p className="text-sm font-semibold text-yellow-400">Landfill/Disposal Fees (TBD)</p>
                                            <p className="text-xs text-yellow-200 mt-1">Pending dump fees will be calculated based on actual waste processed</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="pt-4">
                        <Button 
                            onClick={onContinue} 
                            className="w-full py-6 text-lg font-bold bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-black shadow-lg shadow-yellow-900/50"
                        >
                            Continue to Contact Info <ArrowRight className="ml-2 h-5 w-5" />
                        </Button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};