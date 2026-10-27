import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Tag, Loader2, MapPin, Gift } from 'lucide-react';
import { getStoredReferralCode, setStoredReferralCode } from '@/utils/referralCodeStorage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { calculateDistanceAndFee } from '@/services/DistanceCalculationService';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { additionalDayIncludesPrint, equipmentNumericId, quoteEquipmentLineForItem } from '@/utils/rentalEquipmentPricing';
import { PriceBreakdownCategory } from '@/components/pricing/PriceBreakdownCategory';
import { useTaxRate } from '@/utils/getTaxRate';
import { calculateBookingTaxBreakdown } from '@/utils/bookingTaxCalculator';
import { resolveRentalDays } from '@/utils/couponRules';
import { useBookingTaxOptions } from '@/hooks/useBookingTaxOptions';
import { UiControlGuide } from '@/components/UiControlGuide';
import { getBookingGuideEntries } from '@/config/uiControlGuideEntries';
import { getProtectionOptionsInfoDescription } from '@/content/protectionOptionsInfoText';
import { useChargesAndFees } from '@/hooks/useChargesAndFees';
import { formatMoney } from '@/utils/chargesAndFeesConfig';

export const OrderSummary = ({
    plan,
    addons,
    contactAddress,
    onProceed,
    isProcessing,
    onCouponApply,
    onReferralApply,
    customerEmail,
    deliveryService,
    fetchedMileageRate,
    fetchedDeliveryFeeFlat,
    rentalStart = null,
    rentalEnd = null,
    equipmentCatalog = [],
}) => {
    const [couponCode, setCouponCode] = useState('');
    const [validatingCoupon, setValidatingCoupon] = useState(false);
    const [appliedCoupon, setAppliedCoupon] = useState(addons?.coupon || null);
    const [referralCodeInput, setReferralCodeInput] = useState('');
    const [validatingReferral, setValidatingReferral] = useState(false);
    const [appliedReferral, setAppliedReferral] = useState(
        addons?.referral?.isValid ? addons.referral : null
    );
    const [autoReferralAttempted, setAutoReferralAttempted] = useState(false);
    const [equipmentPrices, setEquipmentPrices] = useState({});
    const [additionalDayPrices, setAdditionalDayPrices] = useState({});
    const [equipmentTypes, setEquipmentTypes] = useState({});
    const [loadingPrices, setLoadingPrices] = useState(false);
    
    const { insurancePrice, taxOptions, drivewayPrice } = useBookingTaxOptions(plan?.id);
    const { fee } = useChargesAndFees();
    const hppCreditLimit = formatMoney(fee('hardware_protection_plan_cap'));
    const { taxRate, loading: loadingTaxRate } = useTaxRate();
    
    const isDeliveryRequired = plan?.id === 1 || (plan?.id === 2 && deliveryService) || plan?.id === 4;
    const showDrivewayProtection = Number(plan?.id) === 1;

    // Load equipment prices from equipment_pricing table (IDs 1-6 only, excluding ID 7)
    useEffect(() => {
        const loadAllPrices = async () => {
            setLoadingPrices(true);
            const prices = {};
            const extraRates = {};
            const types = {};
            const catalogById = new Map(
                (equipmentCatalog || []).map((item) => [Number(item.dbId), item])
            );

            try {
                if (addons?.equipment && addons.equipment.length > 0) {
                    for (const item of addons.equipment) {
                        const equipmentId = equipmentNumericId(item);
                        if (!equipmentId) continue;

                        const catalogItem = catalogById.get(equipmentId);
                        if (catalogItem) {
                            prices[equipmentId] = Number(catalogItem.price || 0);
                            extraRates[equipmentId] = Number(catalogItem.additionalDayPrice || 0);
                            types[equipmentId] = catalogItem.type || 'rental';
                            continue;
                        }

                        const price = await getPriceForEquipment(equipmentId);
                        prices[equipmentId] = price;
                    }
                }

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
                setAdditionalDayPrices(extraRates);
                setEquipmentTypes(types);
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
    }, [addons?.equipment, addons?.mattressDisposal, addons?.tvDisposal, addons?.applianceDisposal, equipmentCatalog]);

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
                body: { couponCode: couponCode.trim(), serviceId: plan.id, rentalDays: resolveRentalDays(rentalStart, rentalEnd) }
            });

            if (error) throw error;

            if (data.isValid) {
                const couponData = {
                    isValid: true,
                    id: data.id,
                    code: data.code,
                    discountType: data.discountType,
                    discountValue: parseFloat(data.discountValue),
                    coupon_kind: data.couponKind || (Array.isArray(data.rules) && data.rules.length ? 'rules' : 'flat'),
                    rules: Array.isArray(data.rules) ? data.rules : [],
                };
                setAppliedCoupon(couponData);
                if (onCouponApply) onCouponApply(couponData);
                const advertisedHeadline = (couponData.rules || []).find(r => r.advertise && r.headline)?.headline;
                toast({
                    title: "Coupon Applied!",
                    description: couponData.coupon_kind === 'rules'
                        ? (advertisedHeadline || "Deal applied based on your rental length.")
                        : `You saved ${data.discountType === 'percentage' ? data.discountValue + '%' : '$' + data.discountValue}!`,
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

    const applyReferralResult = (referralData, { silent = false } = {}) => {
        if (referralData?.isValid) {
            setAppliedReferral(referralData);
            setReferralCodeInput(referralData.code);
            setStoredReferralCode(referralData.code);
            if (onReferralApply) onReferralApply(referralData);
            if (!silent) {
                toast({
                    title: 'Referral Code Applied',
                    description: 'Your friend will receive referral rewards when your booking is completed.',
                });
            }
            return true;
        }

        if (!silent) {
            toast({
                title: 'Invalid Referral Code',
                description: referralData?.error || 'This referral code is not valid.',
                variant: 'destructive',
            });
        }
        return false;
    };

    const validateReferralCode = async (code, { silent = false } = {}) => {
        const normalizedCode = String(code || '').trim();
        if (!normalizedCode) {
            if (!silent) {
                toast({
                    title: 'Invalid Referral Code',
                    description: 'Please enter a referral code.',
                    variant: 'destructive',
                });
            }
            return false;
        }

        setValidatingReferral(true);
        try {
            const { data, error } = await supabase.rpc('validate_referral_code', {
                p_referral_code: normalizedCode,
                p_referee_email: customerEmail?.trim().toLowerCase() || null,
            });

            if (error) throw error;
            return applyReferralResult(data, { silent });
        } catch (error) {
            console.error('Referral validation error:', error);
            if (!silent) {
                toast({
                    title: 'Error',
                    description: 'Failed to validate referral code. Please try again.',
                    variant: 'destructive',
                });
            }
            return false;
        } finally {
            setValidatingReferral(false);
        }
    };

    const handleReferralValidation = async () => {
        await validateReferralCode(referralCodeInput);
    };

    const handleRemoveReferral = () => {
        setAppliedReferral(null);
        setReferralCodeInput('');
        setStoredReferralCode('');
        if (onReferralApply) onReferralApply(null);
        toast({
            title: 'Referral Code Removed',
            description: 'The referral code has been removed from your order.',
        });
    };

    useEffect(() => {
        if (autoReferralAttempted || appliedReferral?.isValid) return;

        const storedCode = getStoredReferralCode();
        const existingCode = addons?.referral?.isValid
            ? addons.referral.code
            : addons?.referralCode;

        const codeToApply = existingCode || storedCode;
        if (!codeToApply) {
            setAutoReferralAttempted(true);
            return;
        }

        setReferralCodeInput(codeToApply);
        setAutoReferralAttempted(true);
        validateReferralCode(codeToApply, { silent: true });
    }, [addons?.referral, addons?.referralCode, appliedReferral?.isValid, autoReferralAttempted, customerEmail]);

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
            const feeResult = calculateDistanceAndFee(deliveryDistance, plan?.id, fetchedMileageRate, addons?.deliveryRoute);
            mileageCharge = Number(feeResult.trip_mileage_cost || 0);
        }

        // Protection Options - Use hook for insurance price (from services table)
        if (addons?.insurance === 'accept') {
            insuranceCost = Number(insurancePrice);
            console.log('[OrderSummary] Insurance cost (from services table):', insuranceCost);
        }

        if (addons?.drivewayProtection === 'accept' && showDrivewayProtection) {
            drivewayProtectionCost = Number(drivewayPrice);
        }

        const rentalQuoteOptions = {
            rentalDays: null,
            dropOff: rentalStart,
            pickup: rentalEnd || rentalStart,
            additionalDayPrices,
            equipmentTypes,
        };

        if (addons?.equipment && Array.isArray(addons.equipment)) {
            addons.equipment.forEach(item => {
                const equipmentId = equipmentNumericId(item);
                if (!equipmentId) return;

                const quote = quoteEquipmentLineForItem(item, equipmentPrices, rentalQuoteOptions);
                if (equipmentId === 3 || equipmentTypes[equipmentId] === 'purchase') {
                    purchaseItemsCost += quote.lineTotal;
                } else {
                    equipmentCost += quote.lineTotal;
                }
            });
        }

        // Disposal costs (IDs 4-6)
        if (plan?.id !== 2) {
            disposalCost = 0;
        }

        const addonsWithDelivery = {
            ...addons,
            deliveryFee: deliveryFeeAmount,
            mileageCharge,
            deliveryDistance: addons?.deliveryDistance,
            coupon: appliedCoupon,
        };

        const taxBreakdown = calculateBookingTaxBreakdown({
            plan,
            addonsData: addonsWithDelivery,
            equipmentPrices,
            taxRate,
            deliveryService: deliveryService ?? false,
            insurancePrice,
            drivewayPrice,
            ...taxOptions,
            dropOff: rentalStart,
            pickup: rentalEnd || rentalStart,
            additionalDayPrices,
            equipmentTypes,
        });

        const pricedBaseRental = (taxBreakdown.lineItems || []).find(l => l.key === 'base_rental')?.amount ?? baseRental;
        const couponDiscount = Number(taxBreakdown.couponDiscount || 0);
        const loyaltyDiscount = Number(taxBreakdown.loyaltyDiscount || addons?.loyaltyDiscountAmount || 0);
        const referralDiscount = Number(taxBreakdown.referralDiscount || addons?.referralDiscountAmount || 0);
        const discount = Number(taxBreakdown.discount ?? couponDiscount + loyaltyDiscount + referralDiscount);
        const lineAmount = (key) => (taxBreakdown.lineItems || []).find(l => l.key === key)?.amount ?? 0;

        return {
            baseRental: pricedBaseRental,
            lineAmount,
            deliveryFee: deliveryFeeAmount,
            mileageCharge,
            insuranceCost,
            drivewayProtectionCost,
            equipmentCost,
            purchaseItemsCost,
            disposalCost,
            discount,
            couponDiscount,
            loyaltyDiscount,
            referralDiscount,
            subtotal: taxBreakdown.subtotalBeforeTax,
            taxableSubtotal: taxBreakdown.taxableSubtotal,
            nonTaxableSubtotal: taxBreakdown.nonTaxableSubtotal,
            tax: taxBreakdown.tax,
            taxRate: taxBreakdown.taxRate,
            total: taxBreakdown.total,
        };
    }, [plan, addons, appliedCoupon, isDeliveryRequired, showDrivewayProtection, fetchedMileageRate, fetchedDeliveryFeeFlat, equipmentPrices, additionalDayPrices, equipmentTypes, insurancePrice, drivewayPrice, taxRate, deliveryService, taxOptions, rentalStart, rentalEnd]);

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
        protectionItems.push({ label: 'Hardware Protection Plan', amount: calculatedTotals.insuranceCost });
    }
    if (calculatedTotals.drivewayProtectionCost > 0) {
        protectionItems.push({ label: 'Driveway Protection', amount: calculatedTotals.drivewayProtectionCost });
    }

    const rentEquipmentItems = [];
    const catalogName = new Map((equipmentCatalog || []).map((item) => [Number(item.dbId), item.label]));
    if (addons?.equipment && Array.isArray(addons.equipment)) {
        addons.equipment.forEach(item => {
            const equipmentId = equipmentNumericId(item);
            if (!equipmentId || equipmentId === 3 || equipmentTypes[equipmentId] === 'purchase') return;

            const quote = quoteEquipmentLineForItem(item, equipmentPrices, {
                dropOff: rentalStart,
                pickup: rentalEnd || rentalStart,
                additionalDayPrices,
                equipmentTypes,
            });
            const itemName = catalogName.get(equipmentId)
                || (equipmentId === 1 ? 'Wheelbarrow' : equipmentId === 2 ? 'Hand Truck' : item.name || `Equipment #${equipmentId}`);
            const note = additionalDayIncludesPrint(quote);

            rentEquipmentItems.push({
                label: `${itemName} (x${quote.quantity})`,
                amount: calculatedTotals.lineAmount(`equipment_${equipmentId}`),
                sublabel: note || undefined,
            });
        });
    }

    const purchaseItems = [];
    if (addons?.equipment && Array.isArray(addons.equipment)) {
        const glovesItem = addons.equipment.find(item => equipmentNumericId(item) === 3);

        if (glovesItem) {
            const quantity = Number(glovesItem.quantity || 1);
            purchaseItems.push({
                label: `Working Gloves (Pair) (x${quantity})`,
                amount: calculatedTotals.lineAmount('equipment_3'),
            });
        }
    }

    const disposalItems = [];
    if (plan?.id !== 2) {
        if (addons?.mattressDisposal && addons.mattressDisposal > 0) {
            disposalItems.push({
                label: `Mattress Disposal (x${addons.mattressDisposal})`,
                amount: calculatedTotals.lineAmount('mattressDisposal'),
            });
        }
        if (addons?.tvDisposal && addons.tvDisposal > 0) {
            disposalItems.push({
                label: `TV Disposal (x${addons.tvDisposal})`,
                amount: calculatedTotals.lineAmount('tvDisposal'),
            });
        }
        if (addons?.applianceDisposal && addons.applianceDisposal > 0) {
            disposalItems.push({
                label: `Appliance Disposal (x${addons.applianceDisposal})`,
                amount: calculatedTotals.lineAmount('applianceDisposal'),
            });
        }
    }

    const discountItems = [];
    if (calculatedTotals.couponDiscount > 0) {
        discountItems.push({ 
            label: `Coupon (${appliedCoupon.code})`, 
            amount: -calculatedTotals.couponDiscount, 
            highlight: true 
        });
    }
    if (calculatedTotals.loyaltyDiscount > 0) {
        discountItems.push({
            label: `Loyalty Points (${Number(addons?.loyaltyPointsToRedeem || 0)} pts)`,
            amount: -calculatedTotals.loyaltyDiscount,
            highlight: true 
        });
    }
    if (calculatedTotals.referralDiscount > 0) {
        discountItems.push({
            label: `Referral Wallet ($${Number(addons?.referralDollarsToRedeem || 0).toFixed(2)})`,
            amount: -calculatedTotals.referralDiscount,
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
                    infoDescription={getProtectionOptionsInfoDescription(plan?.name, hppCreditLimit)}
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

            {!appliedReferral && (
                <div className="mt-6">
                    <label className="text-sm font-medium text-white mb-2 block flex items-center">
                        <Gift className="h-4 w-4 mr-2 text-yellow-400" />
                        Have a referral code?
                    </label>
                    <p className="text-xs text-blue-200 mb-2">
                        Enter a friend&apos;s code so they can earn rewards when your booking is completed.
                    </p>
                    <div className="flex gap-2">
                        <Input
                            value={referralCodeInput}
                            onChange={(e) => setReferralCodeInput(e.target.value.toUpperCase())}
                            placeholder="Enter referral code"
                            className="bg-white/10 border-white/30 text-white placeholder-gray-400"
                            disabled={validatingReferral}
                        />
                        <Button
                            onClick={handleReferralValidation}
                            disabled={validatingReferral || !referralCodeInput.trim()}
                            variant="outline"
                            className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black"
                        >
                            {validatingReferral ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                        </Button>
                    </div>
                </div>
            )}

            {appliedReferral && (
                <div className="mt-6 bg-blue-900/20 border border-blue-500/30 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <Gift className="h-4 w-4 mr-2 text-blue-300" />
                            <span className="text-sm font-medium text-blue-200">
                                Referral Applied: {appliedReferral.code}
                            </span>
                        </div>
                        <button
                            onClick={handleRemoveReferral}
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
            <UiControlGuide
                stepTitle="Add-ons"
                entries={getBookingGuideEntries('addons')}
                className="mt-3 flex justify-end"
            />
        </motion.div>
    );
};