import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Tag, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { calculateDistanceAndFee } from '@/services/DistanceCalculationService';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';
import { useDrivewayProtectionPrice } from '@/hooks/useDrivewayProtectionPrice';
import { PriceBreakdownCategory } from '@/components/pricing/PriceBreakdownCategory';
import { useTaxRate } from '@/utils/getTaxRate';
import { calculateTaxAmount } from '@/utils/calculateTaxAmount';

export const OrderSummary = ({
    plan,
    addons,
    contactAddress,
    onProceed,
    isProcessing,
    onCouponApply,
    deliveryService,
    fetchedMileageRate,
    fetchedDeliveryFeeFlat
}) => {
    const [couponCode, setCouponCode] = useState('');
    const [validatingCoupon, setValidatingCoupon] = useState(false);
    const [appliedCoupon, setAppliedCoupon] = useState(addons?.coupon || null);
    const [equipmentPrices, setEquipmentPrices] = useState({});
    const [loadingPrices, setLoadingPrices] = useState(false);
    
    const { insurancePrice } = useInsurancePricing();
    const { drivewayPrice } = useDrivewayProtectionPrice();
    const { taxRate, loading: loadingTaxRate } = useTaxRate();
    
    const isDeliveryRequired = plan?.id === 1 || (plan?.id === 2 && deliveryService) || plan?.id === 4;
    const showDrivewayProtection = plan?.id === 1 || (plan?.id === 2 && deliveryService);

    // Detect if this is a dump loader service
    const isDumpLoaderService = plan?.name && 
                                (plan.name.toLowerCase().includes('dump loader') ||
                                 plan.name.toLowerCase().includes('dump trailer') ||
                                 plan.name.toLowerCase().includes('loader trailer')) &&
                                !plan.name.toLowerCase().includes('16 yard') &&
                                !plan.name.toLowerCase().includes('dumpster');

    // Service-specific Protection Options info text
    const getProtectionOptionsInfoText = () => {
        if (isDumpLoaderService) {
            return "Insurance covers damage to the rental equipment while in your possession during loading. This provides peace of mind if the bin, doors, hinges, or equipment are accidentally damaged while you have it. Insurance covers the first $500 of repair costs.";
        }
        return "Insurance covers damage to the rental equipment. Driveway protection prevents damage to your property during delivery.";
    };

    // Load equipment prices from equipment_pricing table
    useEffect(() => {
        const loadAllPrices = async () => {
            setLoadingPrices(true);
            const prices = {};

            try {
                // Load equipment prices (IDs 1-6)
                if (addons?.equipment && addons.equipment.length > 0) {
                    for (const item of addons.equipment) {
                        const equipmentId = item.equipment_id || item.dbId || item.id;
                        
                        if (!equipmentId) {
                            console.warn('[OrderSummary] Equipment item missing ID:', item);
                            continue;
                        }

                        if (!isValidEquipmentId(equipmentId)) {
                            console.error('[OrderSummary] Invalid equipment ID format:', equipmentId);
                            continue;
                        }

                        const price = await getPriceForEquipment(equipmentId);
                        prices[equipmentId] = price;
                    }
                }

                // Load disposal item prices (IDs 4, 5, 6)
                const disposalItems = [
                    { key: 'mattressDisposal', dbId: 4 },
                    { key: 'tvDisposal', dbId: 5 },
                    { key: 'applianceDisposal', dbId: 6 }
                ];

                for (const disposal of disposalItems) {
                    if (addons?.[disposal.key] && addons[disposal.key] > 0) {
                        const price = await getPriceForEquipment(disposal.dbId);
                        prices[disposal.dbId] = price;
                    }
                }

                setEquipmentPrices(prices);
            } catch (error) {
                console.error('[OrderSummary] Error loading prices:', error);
                toast({
                    title: 'Error Loading Prices',
                    description: 'Some prices could not be loaded from database.',
                    variant: 'destructive'
                });
            } finally {
                setLoadingPrices(false);
            }
        };

        loadAllPrices();
    }, [addons?.equipment, addons?.mattressDisposal, addons?.tvDisposal, addons?.applianceDisposal]);

    const handleCouponValidation = async () => {
        if (!couponCode.trim()) {
            toast({
                title: "Invalid Coupon",
                description: "Please enter a coupon code.",
                variant: "destructive",
            });
            return;
        }

        setValidatingCoupon(true);

        try {
            const { data, error } = await supabase.functions.invoke('validate-coupon', {
                body: { couponCode: couponCode.trim(), serviceId: plan.id }
            });

            if (error) throw error;

            if (data.isValid) {
                const couponData = {
                    isValid: true,
                    code: data.code,
                    discountType: data.discountType,
                    discountValue: parseFloat(data.discountValue)
                };
                setAppliedCoupon(couponData);
                if (onCouponApply) onCouponApply(couponData);
                toast({
                    title: "Coupon Applied!",
                    description: `You saved ${data.discountType === 'percentage' ? data.discountValue + '%' : '$' + data.discountValue}!`,
                });
            } else {
                toast({
                    title: "Invalid Coupon",
                    description: data.error || "This coupon is not valid for the selected service.",
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error('Coupon validation error:', error);
            toast({
                title: "Error",
                description: "Failed to validate coupon. Please try again.",
                variant: "destructive",
            });
        } finally {
            setValidatingCoupon(false);
        }
    };

    const handleRemoveCoupon = () => {
        setAppliedCoupon(null);
        setCouponCode('');
        if (onCouponApply) onCouponApply(null);
        toast({
            title: "Coupon Removed",
            description: "The coupon has been removed from your order.",
        });
    };

    const calculatedTotals = useMemo(() => {
        const baseRental = Number(plan?.price || 0);
        
        let deliveryFeeAmount = 0;
        let mileageCharge = 0;
        let insuranceCost = 0;
        let drivewayProtectionCost = 0;
        let equipmentCost = 0;
        let purchaseItemsCost = 0;
        let disposalCost = 0;

        // Service Costs
        if (isDeliveryRequired) {
            deliveryFeeAmount = Number(fetchedDeliveryFeeFlat || 0);
        }

        // Distance-based mileage charge
        const deliveryDistance = Number(addons?.deliveryDistance || 0);
        if (isDeliveryRequired && deliveryDistance > 0) {
            const feeResult = calculateDistanceAndFee(deliveryDistance, plan?.id, fetchedMileageRate);
            mileageCharge = Number(feeResult.trip_mileage_cost || 0);
        }

        // Protection Options
        if (addons?.insurance === 'accept') {
            insuranceCost = Number(insurancePrice || 20);
        }

        if (addons?.drivewayProtection === 'accept' && showDrivewayProtection) {
            drivewayProtectionCost = Number(drivewayPrice || 15);
        }

        // Equipment (Rent) and Items for Purchase
        if (addons?.equipment && Array.isArray(addons.equipment)) {
            addons.equipment.forEach(item => {
                const equipmentId = item.equipment_id || item.dbId || item.id;
                
                if (!equipmentId || !isValidEquipmentId(equipmentId)) {
                    return;
                }

                const price = Number(equipmentPrices[equipmentId] || 0);
                const quantity = Number(item.quantity || 1);
                const itemTotal = price * quantity;

                // Equipment ID 3 is Working Gloves (purchase item)
                if (equipmentId === 3) {
                    purchaseItemsCost += itemTotal;
                } else {
                    equipmentCost += itemTotal;
                }
            });
        }

        // Disposal costs
        if (plan?.id !== 2) {
            if (addons?.mattressDisposal && addons.mattressDisposal > 0) {
                const price = Number(equipmentPrices[4] || 25);
                disposalCost += price * addons.mattressDisposal;
            }
            if (addons?.tvDisposal && addons.tvDisposal > 0) {
                const price = Number(equipmentPrices[5] || 15);
                disposalCost += price * addons.tvDisposal;
            }
            if (addons?.applianceDisposal && addons.applianceDisposal > 0) {
                const price = Number(equipmentPrices[6] || 35);
                disposalCost += price * addons.applianceDisposal;
            }
        }

        // Calculate subtotal before discount
        let subtotalBeforeDiscount = baseRental + deliveryFeeAmount + mileageCharge + insuranceCost + drivewayProtectionCost + equipmentCost + purchaseItemsCost + disposalCost;

        // Apply coupon discount
        let discount = 0;
        if (appliedCoupon?.isValid) {
            if (appliedCoupon.discountType === 'fixed') {
                discount = Number(appliedCoupon.discountValue);
            } else if (appliedCoupon.discountType === 'percentage') {
                discount = (subtotalBeforeDiscount * Number(appliedCoupon.discountValue)) / 100;
            }
        }

        // Subtotal after discount (before tax)
        const subtotal = Math.max(0, subtotalBeforeDiscount - discount);
        
        // Tax: use dynamic tax rate from database
        const tax = calculateTaxAmount(subtotal, taxRate);
        
        // Total: subtotal + tax
        const total = subtotal + tax;

        return {
            baseRental,
            deliveryFee: deliveryFeeAmount,
            mileageCharge,
            insuranceCost,
            drivewayProtectionCost,
            equipmentCost,
            purchaseItemsCost,
            disposalCost,
            discount,
            subtotal,
            tax,
            taxRate,
            total
        };
    }, [plan, addons, appliedCoupon, isDeliveryRequired, showDrivewayProtection, fetchedMileageRate, fetchedDeliveryFeeFlat, equipmentPrices, insurancePrice, drivewayPrice, taxRate]);

    const handleProceedClick = () => {
        if (!isDeliveryRequired) {
            onProceed(0, 0);
            return;
        }

        const dAddress = addons?.deliveryAddress;
        if (!dAddress || !dAddress.street || !dAddress.city || !dAddress.state || !dAddress.zip) {
            toast({
                title: "Missing Delivery Address",
                description: "Please provide a complete delivery address before proceeding.",
                variant: "destructive"
            });
            return;
        }

        onProceed(calculatedTotals.deliveryFee, calculatedTotals.mileageCharge);
    };

    if (loadingPrices || loadingTaxRate) {
        return (
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20 sticky top-8">
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
                    <span className="ml-3 text-white">Loading prices...</span>
                </div>
            </div>
        );
    }

    // Prepare category items
    const serviceItems = [];
    if (calculatedTotals.baseRental > 0) {
        serviceItems.push({ label: 'Base Rental', amount: calculatedTotals.baseRental });
    }
    if (calculatedTotals.deliveryFee > 0) {
        serviceItems.push({ label: 'Base Delivery Fee', amount: calculatedTotals.deliveryFee });
    }
    if (calculatedTotals.mileageCharge > 0) {
        serviceItems.push({ 
            label: 'Mileage Charge', 
            amount: calculatedTotals.mileageCharge,
            sublabel: addons?.distanceFeeDisplay 
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
    if (addons?.equipment && Array.isArray(addons.equipment)) {
        addons.equipment.forEach(item => {
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
    if (addons?.equipment && Array.isArray(addons.equipment)) {
        const glovesItem = addons.equipment.find(item => {
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
    if (plan?.id !== 2) {
        if (addons?.mattressDisposal && addons.mattressDisposal > 0) {
            const price = Number(equipmentPrices[4] || 25);
            disposalItems.push({ 
                label: `Mattress Disposal (x${addons.mattressDisposal})`, 
                amount: price * addons.mattressDisposal 
            });
        }
        if (addons?.tvDisposal && addons.tvDisposal > 0) {
            const price = Number(equipmentPrices[5] || 15);
            disposalItems.push({ 
                label: `TV Disposal (x${addons.tvDisposal})`, 
                amount: price * addons.tvDisposal 
            });
        }
        if (addons?.applianceDisposal && addons.applianceDisposal > 0) {
            const price = Number(equipmentPrices[6] || 35);
            disposalItems.push({ 
                label: `Appliance Disposal (x${addons.applianceDisposal})`, 
                amount: price * addons.applianceDisposal 
            });
        }
    }

    const discountItems = [];
    if (calculatedTotals.discount > 0) {
        discountItems.push({ 
            label: `Coupon (${appliedCoupon.code})`, 
            amount: -calculatedTotals.discount, 
            highlight: true 
        });
    }

    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20 sticky top-8"
        >
            <h3 className="text-2xl font-bold text-white mb-6">Order Summary</h3>

            <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
                {/* 1. Service Costs */}
                <PriceBreakdownCategory
                    icon="📦"
                    title="Service Costs"
                    items={serviceItems}
                />

                {/* 2. Protection Options - Service-specific info text */}
                <PriceBreakdownCategory
                    icon="🛡️"
                    title="Protection Options"
                    items={protectionItems}
                    showInfoButton={true}
                    infoTitle="Protection Options"
                    infoDescription={getProtectionOptionsInfoText()}
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
                <div className="border-t border-white/20 pt-4 space-y-2">
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

                {/* 8. Landfill/Disposal Fees (For Delivery Services Only) */}
                {isDeliveryRequired && (
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

            {/* Coupon Section */}
            {!appliedCoupon && (
                <div className="mt-6">
                    <label className="text-sm font-medium text-white mb-2 block flex items-center">
                        <Tag className="h-4 w-4 mr-2 text-yellow-400" />
                        Have a coupon code?
                    </label>
                    <div className="flex gap-2">
                        <Input
                            value={couponCode}
                            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                            placeholder="Enter code"
                            className="bg-white/10 border-white/30 text-white placeholder-gray-400"
                            disabled={validatingCoupon}
                        />
                        <Button
                            onClick={handleCouponValidation}
                            disabled={validatingCoupon || !couponCode.trim()}
                            variant="outline"
                            className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black"
                        >
                            {validatingCoupon ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                        </Button>
                    </div>
                </div>
            )}

            {appliedCoupon && (
                <div className="mt-6 bg-green-900/20 border border-green-500/30 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <Tag className="h-4 w-4 mr-2 text-green-400" />
                            <span className="text-sm font-medium text-green-300">
                                Coupon Applied: {appliedCoupon.code}
                            </span>
                        </div>
                        <button
                            onClick={handleRemoveCoupon}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                            Remove
                        </button>
                    </div>
                </div>
            )}

            <Button
                onClick={handleProceedClick}
                disabled={isProcessing}
                className="w-full py-4 text-lg font-semibold bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg shadow-green-900/50 hover:from-green-400 hover:to-emerald-500 transition-all mt-6"
            >
                {isProcessing ? (
                    <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Processing...
                    </>
                ) : (
                    <>
                        Proceed to Contact Info
                        <ArrowRight className="ml-2" />
                    </>
                )}
            </Button>
        </motion.div>
    );
};