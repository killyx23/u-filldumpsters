import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Tag, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { calculateDistanceAndFee } from '@/services/DistanceCalculationService';
import { getEquipmentPricingMetaMap } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';
import { useDrivewayProtectionPrice } from '@/hooks/useDrivewayProtectionPrice';
import { PriceBreakdownCategory } from '@/components/pricing/PriceBreakdownCategory';
import { useTaxRate } from '@/utils/getTaxRate';
import { calculateItemizedTax, resolveDeliveryType } from '@/utils/calculateTaxAmount';

export const OrderSummary = ({
    plan,
    addons,
    contactAddress,
    onProceed,
    isProcessing,
    onCouponApply,
    deliveryService,
    fetchedMileageRate,
    fetchedDeliveryFeeFlat,
    // is_taxable flags for the service-level charges (loaded from services table by parent)
    serviceTaxable        = true,
    deliveryFeeTaxable    = true,
    mileageTaxable        = true,
}) => {
    const [couponCode, setCouponCode] = useState('');
    const [validatingCoupon, setValidatingCoupon] = useState(false);
    const [appliedCoupon, setAppliedCoupon] = useState(addons?.coupon || null);

    // Map of equipmentId → { price, is_taxable }
    const [equipmentMeta, setEquipmentMeta] = useState({});
    const [loadingPrices, setLoadingPrices] = useState(false);

    const { insurancePrice } = useInsurancePricing();
    const { drivewayPrice }  = useDrivewayProtectionPrice();

    // Determine delivery type from plan + deliveryService flag for correct tax rate
    const deliveryType = resolveDeliveryType(plan, deliveryService);

    // Delivery ZIP for potential TaxJar lookup
    const deliveryZip = addons?.deliveryAddress?.zip ?? contactAddress?.zip ?? null;

    const { taxRate, loading: loadingTaxRate } = useTaxRate(deliveryType, deliveryZip);

    const isDeliveryRequired  = plan?.id === 1 || (plan?.id === 2 && deliveryService) || plan?.id === 4;
    const showDrivewayProtection = plan?.id === 1 || (plan?.id === 2 && deliveryService);

    const isDumpLoaderService = plan?.name && 
        (plan.name.toLowerCase().includes('dump loader') ||
         plan.name.toLowerCase().includes('dump trailer') ||
         plan.name.toLowerCase().includes('loader trailer')) &&
        !plan.name.toLowerCase().includes('16 yard') &&
        !plan.name.toLowerCase().includes('dumpster');

    const getProtectionOptionsInfoText = () => {
        if (isDumpLoaderService) {
            return "Insurance covers damage to the rental equipment while in your possession during loading. This provides peace of mind if the bin, doors, hinges, or equipment are accidentally damaged while you have it. Insurance covers the first $500 of repair costs.";
        }
        return "Insurance covers damage to the rental equipment. Driveway protection prevents damage to your property during delivery.";
    };

    // ── Load equipment pricing meta (price + is_taxable) ─────────────────────
    useEffect(() => {
        const loadAllMeta = async () => {
            setLoadingPrices(true);

            const idsToLoad = new Set();

            if (addons?.equipment?.length > 0) {
                for (const item of addons.equipment) {
                    const id = item.equipment_id || item.dbId || item.id;
                    if (id && isValidEquipmentId(id)) idsToLoad.add(Number(id));
                }
            }

            // Disposal items
            if (addons?.mattressDisposal > 0)  idsToLoad.add(4);
            if (addons?.tvDisposal > 0)         idsToLoad.add(5);
            if (addons?.applianceDisposal > 0)  idsToLoad.add(6);

            // Insurance
            idsToLoad.add(7);

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
                console.error('[OrderSummary] Error loading equipment meta:', error);
                toast({ title: 'Error Loading Prices', description: 'Some prices could not be loaded from database.', variant: 'destructive' });
            } finally {
                setLoadingPrices(false);
            }
        };

        loadAllMeta();
    }, [addons?.equipment, addons?.mattressDisposal, addons?.tvDisposal, addons?.applianceDisposal]);

    // ── Coupon handlers ───────────────────────────────────────────────────────
    const handleCouponValidation = async () => {
        if (!couponCode.trim()) {
            toast({ title: "Invalid Coupon", description: "Please enter a coupon code.", variant: "destructive" });
            return;
        }
        setValidatingCoupon(true);
        try {
            const { data, error } = await supabase.functions.invoke('validate-coupon', {
                body: { couponCode: couponCode.trim(), serviceId: plan.id },
            });
            if (error) throw error;
            if (data.isValid) {
                const couponData = {
                    isValid:       true,
                    code:          data.code,
                    discountType:  data.discountType,
                    discountValue: parseFloat(data.discountValue),
                };
                setAppliedCoupon(couponData);
                if (onCouponApply) onCouponApply(couponData);
                toast({ title: "Coupon Applied!", description: `You saved ${data.discountType === 'percentage' ? data.discountValue + '%' : '$' + data.discountValue}!` });
            } else {
                toast({ title: "Invalid Coupon", description: data.error || "This coupon is not valid for the selected service.", variant: "destructive" });
            }
        } catch (error) {
            console.error('Coupon validation error:', error);
            toast({ title: "Error", description: "Failed to validate coupon. Please try again.", variant: "destructive" });
        } finally {
            setValidatingCoupon(false);
        }
    };

    const handleRemoveCoupon = () => {
        setAppliedCoupon(null);
        setCouponCode('');
        if (onCouponApply) onCouponApply(null);
        toast({ title: "Coupon Removed", description: "The coupon has been removed from your order." });
    };

    // ── Build itemized line items ──────────────────────────────────────────────
    const { lineItems, calculatedTotals } = useMemo(() => {
        const meta = (id) => equipmentMeta[Number(id)] ?? { price: 0, is_taxable: true };

        const items = [];

        // 1. Base rental
        const baseRental = Number(plan?.price || plan?.base_price || 0);
        if (baseRental > 0) {
            items.push({ label: 'Base Rental', amount: baseRental, is_taxable: serviceTaxable });
        }

        // 2. Delivery fee (flat)
        if (isDeliveryRequired) {
            const deliveryFee = Number(fetchedDeliveryFeeFlat || 0);
            if (deliveryFee > 0) {
                items.push({ label: 'Base Delivery Fee', amount: deliveryFee, is_taxable: deliveryFeeTaxable });
            }
        }

        // 3. Mileage charge
        const deliveryDistance = Number(addons?.deliveryDistance || 0);
        let mileageCharge = 0;
        if (isDeliveryRequired && deliveryDistance > 0) {
            const feeResult = calculateDistanceAndFee(deliveryDistance, plan?.id, fetchedMileageRate);
            mileageCharge = Number(feeResult.trip_mileage_cost || 0);
        }
        if (mileageCharge > 0) {
            items.push({ label: 'Mileage Charge', amount: mileageCharge, is_taxable: mileageTaxable, sublabel: addons?.distanceFeeDisplay });
        }

        // 4. Insurance — is_taxable comes from DB (non-taxable in Utah)
        if (addons?.insurance === 'accept') {
            const ins = meta(7);
            const insuranceCost = Number(ins.price || insurancePrice || 20);
            if (insuranceCost > 0) {
                items.push({ label: 'Rental Insurance', amount: insuranceCost, is_taxable: ins.is_taxable });
            }
        }

        // 5. Driveway protection
        if (addons?.drivewayProtection === 'accept' && showDrivewayProtection) {
            const drivewayAmt = Number(drivewayPrice || 15);
            if (drivewayAmt > 0) {
                items.push({ label: 'Driveway Protection', amount: drivewayAmt, is_taxable: true });
            }
        }

        // 6. Rental equipment & consumables
        if (addons?.equipment?.length > 0) {
            for (const item of addons.equipment) {
                const id = item.equipment_id || item.dbId || item.id;
                if (!id || !isValidEquipmentId(id)) continue;
                const { price, is_taxable } = meta(id);
                const quantity = Number(item.quantity || 1);
                const total    = price * quantity;
                if (total === 0) continue;
                const label = id === 1 ? 'Wheelbarrow' : id === 2 ? 'Hand Truck' : id === 3 ? 'Working Gloves (Pair)' : `Equipment #${id}`;
                items.push({ label: `${label}${quantity > 1 ? ` (x${quantity})` : ''}`, amount: total, is_taxable });
            }
        }

        // 7. Disposal items (not available for dump loader self-service — plan 2)
        if (plan?.id !== 2) {
            for (const [key, dbId, singular] of [
                ['mattressDisposal', 4, 'Mattress Disposal'],
                ['tvDisposal',       5, 'TV Disposal'],
                ['applianceDisposal', 6, 'Appliance Disposal'],
            ]) {
                const qty = Number(addons?.[key] || 0);
                if (qty > 0) {
                    const { price, is_taxable } = meta(dbId);
                    items.push({ label: `${singular} (x${qty})`, amount: price * qty, is_taxable });
                }
            }
        }

        // 8. Coupon discount — applied against taxable subtotal
        let discount = 0;
        if (appliedCoupon?.isValid) {
            const taxableSum = items.filter(i => i.is_taxable).reduce((s, i) => s + i.amount, 0);
            const fullSum    = items.reduce((s, i) => s + i.amount, 0);
            if (appliedCoupon.discountType === 'fixed') {
                discount = Number(appliedCoupon.discountValue);
            } else if (appliedCoupon.discountType === 'percentage') {
                discount = (fullSum * Number(appliedCoupon.discountValue)) / 100;
            }
            discount = Math.min(discount, taxableSum); // cannot discount more than taxable base
            if (discount > 0) {
                items.push({ label: `Coupon (${appliedCoupon.code})`, amount: -discount, is_taxable: true });
            }
        }

        const totals = calculateItemizedTax(items, taxRate);

        return { lineItems: items, calculatedTotals: { ...totals, discount } };
    }, [
        plan, addons, appliedCoupon, isDeliveryRequired, showDrivewayProtection,
        fetchedMileageRate, fetchedDeliveryFeeFlat, equipmentMeta,
        insurancePrice, drivewayPrice, taxRate,
        serviceTaxable, deliveryFeeTaxable, mileageTaxable,
    ]);

    // ── Proceed handler ───────────────────────────────────────────────────────
    const handleProceedClick = () => {
        if (!isDeliveryRequired) {
            onProceed(0, 0);
            return;
        }
        const dAddress = addons?.deliveryAddress;
        if (!dAddress?.street || !dAddress?.city || !dAddress?.state || !dAddress?.zip) {
            toast({ title: "Missing Delivery Address", description: "Please provide a complete delivery address before proceeding.", variant: "destructive" });
            return;
        }
        const deliveryFeeItem = lineItems.find(i => i.label === 'Base Delivery Fee');
        const mileageItem     = lineItems.find(i => i.label === 'Mileage Charge');
        onProceed(deliveryFeeItem?.amount ?? 0, mileageItem?.amount ?? 0);
    };

    // ── Loading state ─────────────────────────────────────────────────────────
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

    // ── Build display categories from lineItems ────────────────────────────────
    const serviceItems      = lineItems.filter(i => ['Base Rental', 'Base Delivery Fee', 'Mileage Charge'].includes(i.label)).map(toDisplayItem);
    const protectionItems   = lineItems.filter(i => ['Rental Insurance', 'Driveway Protection'].includes(i.label)).map(toDisplayItem);
    const rentEquipItems    = lineItems.filter(i => !['Base Rental','Base Delivery Fee','Mileage Charge','Rental Insurance','Driveway Protection'].includes(i.label) && i.amount > 0 && !i.label.startsWith('Working Gloves') && !i.label.endsWith('Disposal') && !i.label.includes('Mattress') && !i.label.includes('TV') && !i.label.includes('Appliance') && !i.label.startsWith('Coupon')).map(toDisplayItem);
    const purchaseItems     = lineItems.filter(i => i.label.startsWith('Working Gloves')).map(toDisplayItem);
    const disposalItems     = lineItems.filter(i => i.label.includes('Disposal')).map(toDisplayItem);
    const discountItems     = lineItems.filter(i => i.amount < 0).map(i => ({ ...toDisplayItem(i), highlight: true }));

    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20 sticky top-8"
        >
            <h3 className="text-2xl font-bold text-white mb-6">Order Summary</h3>

            <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
                <PriceBreakdownCategory icon="📦" title="Service Costs" items={serviceItems} />

                <PriceBreakdownCategory
                    icon="🛡️"
                    title="Protection Options"
                    items={protectionItems}
                    showInfoButton={true}
                    infoTitle="Protection Options"
                    infoDescription={getProtectionOptionsInfoText()}
                    serviceName={plan?.name}
                />

                <PriceBreakdownCategory icon="🚚" title="Rent Equipment" items={rentEquipItems} />
                <PriceBreakdownCategory icon="🛒" title="Items for Purchase" items={purchaseItems} />

                <PriceBreakdownCategory
                    icon="♻️"
                    title="Disposal Items"
                    items={disposalItems}
                    showInfoButton={true}
                    infoTitle="Disposal Items"
                    infoDescription="Special disposal fees for materials that require certified waste facility processing (mattresses, TVs, appliances)."
                />

                <PriceBreakdownCategory icon="🏷️" title="Discounts" items={discountItems} />

                {/* Totals */}
                <div className="border-t border-white/20 pt-4 space-y-2">
                    {calculatedTotals.nonTaxableSubtotal > 0 && (
                        <div className="flex justify-between items-center text-xs text-blue-300/70">
                            <span>Non-taxable items (e.g. insurance)</span>
                            <span>${calculatedTotals.nonTaxableSubtotal.toFixed(2)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-blue-200 font-semibold">Subtotal</span>
                        <span className="text-white font-bold">${calculatedTotals.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-blue-200 font-semibold">
                            Tax ({calculatedTotals.taxRate.toFixed(2)}%
                            {deliveryType === 'delivery' ? ' · delivery rate' : ' · pickup rate'})
                        </span>
                        <span className="text-white font-bold">${calculatedTotals.taxAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-lg pt-2 border-t border-white/10">
                        <span className="text-white font-bold">Total</span>
                        <span className="text-green-400 font-bold">${calculatedTotals.total.toFixed(2)}</span>
                    </div>
                </div>

                {/* Landfill/Disposal Fees notice (delivery services only) */}
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

            {/* Coupon section */}
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
                            <span className="text-sm font-medium text-green-300">Coupon Applied: {appliedCoupon.code}</span>
                        </div>
                        <button onClick={handleRemoveCoupon} className="text-xs text-red-400 hover:text-red-300 transition-colors">
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
                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Processing...</>
                ) : (
                    <>Proceed to Contact Info<ArrowRight className="ml-2" /></>
                )}
            </Button>
        </motion.div>
    );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toDisplayItem(item) {
    return {
        label:    item.label,
        amount:   item.amount,
        sublabel: item.sublabel,
        // Expose taxability for potential tooltip/badge display in PriceBreakdownCategory
        is_taxable: item.is_taxable,
    };
}
