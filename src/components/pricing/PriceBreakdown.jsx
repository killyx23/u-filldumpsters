import React, { useState, useEffect, useMemo } from 'react';
import { PriceBreakdownCategory } from '@/components/pricing/PriceBreakdownCategory';
import { getEquipmentPricingMetaMap } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';
import { useTaxRate } from '@/utils/getTaxRate';
import { calculateItemizedTax, resolveDeliveryType } from '@/utils/calculateTaxAmount';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';
import { useDrivewayProtectionPrice } from '@/hooks/useDrivewayProtectionPrice';

/**
 * Reusable Price Breakdown Component
 * Displays booking charges in standardized 8-category format
 */
export const PriceBreakdown = ({ 
  booking, 
  plan, 
  addons = {}, 
  basePrice = 0,
  className = '',
  showLandfillFees = true
}) => {
  const [equipmentMeta, setEquipmentMeta] = useState({});
  const [loading, setLoading] = useState(true);

  const deliveryType =
    booking?.delivery_type ?? resolveDeliveryType(plan, addons?.deliveryService);
  const deliveryZip =
    addons?.deliveryAddress?.zip ??
    booking?.zip ??
    booking?.contactAddress?.zip ??
    null;
  const { taxRate, loading: loadingTaxRate } = useTaxRate(deliveryType, deliveryZip);
  const { insurancePrice, loading: loadingInsurancePrice } = useInsurancePricing();
  const { drivewayPrice, loading: loadingDrivewayPrice } = useDrivewayProtectionPrice();

  useEffect(() => {
    const loadMeta = async () => {
      setLoading(true);
      try {
        const ids = [1, 2, 3, 4, 5, 6].filter(isValidEquipmentId);
        const meta = await getEquipmentPricingMetaMap(ids);
        setEquipmentMeta(meta);
      } catch (error) {
        console.error('[PriceBreakdown] Error loading equipment pricing meta:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMeta();
  }, []);

  const calculatedTotals = useMemo(() => {
    const meta = (id) => equipmentMeta[Number(id)] ?? { price: 0, is_taxable: true };

    const baseRental = Number(basePrice || plan?.price || booking?.plan?.base_price || 0);
    const deliveryFeeFlat = Number(addons?.deliveryFee || 0);
    const mileageCharge = Number(addons?.mileageCharge || 0);

    const insuranceCost = addons?.insurance === 'accept'
      ? Number(addons?.insurancePriceApplied ?? insurancePrice ?? 0)
      : 0;
    const showDriveway =
      plan?.id === 1 || plan?.id === 4 || (plan?.id === 2 && addons?.deliveryService);
    const drivewayProtectionCost =
      showDriveway && addons?.drivewayProtection === 'accept'
        ? Number(addons?.drivewayPriceApplied ?? drivewayPrice ?? 0)
        : 0;

    let rentEquipmentCost = 0;
    let purchaseItemsCost = 0;

    if (addons?.equipment && Array.isArray(addons.equipment)) {
      addons.equipment.forEach(item => {
        const equipmentId = item.equipment_id || item.dbId || item.id;
        if (!equipmentId || !isValidEquipmentId(equipmentId) || Number(equipmentId) === 7) return;

        const price = Number(meta(equipmentId).price || 0);
        const quantity = Number(item.quantity || 1);
        const itemTotal = price * quantity;

        if (equipmentId === 3) {
          purchaseItemsCost += itemTotal;
        } else {
          rentEquipmentCost += itemTotal;
        }
      });
    }

    let disposalCost = 0;
    if (plan?.id !== 2) {
      if (addons?.mattressDisposal && addons.mattressDisposal > 0) {
        disposalCost += Number(meta(4).price ?? 0) * addons.mattressDisposal;
      }
      if (addons?.tvDisposal && addons.tvDisposal > 0) {
        disposalCost += Number(meta(5).price ?? 0) * addons.tvDisposal;
      }
      if (addons?.applianceDisposal && addons.applianceDisposal > 0) {
        disposalCost += Number(meta(6).price ?? 0) * addons.applianceDisposal;
      }
    }

    const items = [];
    if (baseRental > 0) {
      items.push({ label: 'Base Rental', amount: baseRental, is_taxable: true });
    }
    if (deliveryFeeFlat > 0) {
      items.push({ label: 'Base Delivery Fee', amount: deliveryFeeFlat, is_taxable: true });
    }
    if (mileageCharge > 0) {
      items.push({
        label: 'Mileage Charge',
        amount: mileageCharge,
        is_taxable: true,
        sublabel: addons?.distanceFeeDisplay,
      });
    }
    if (insuranceCost > 0) {
      items.push({ label: 'Rental Insurance', amount: insuranceCost, is_taxable: false });
    }
    if (drivewayProtectionCost > 0) {
      items.push({ label: 'Driveway Protection', amount: drivewayProtectionCost, is_taxable: true });
    }

    if (addons?.equipment && Array.isArray(addons.equipment)) {
      for (const item of addons.equipment) {
        const id = item.equipment_id || item.dbId || item.id;
        if (!id || !isValidEquipmentId(id) || Number(id) === 7) continue;
        const { price, is_taxable } = meta(id);
        const quantity = Number(item.quantity || 1);
        const total = price * quantity;
        if (total === 0) continue;
        const label =
          id === 1 ? 'Wheelbarrow' :
          id === 2 ? 'Hand Truck' :
          id === 3 ? 'Working Gloves (Pair)' :
          `Equipment #${id}`;
        items.push({
          label: `${label}${quantity > 1 ? ` (x${quantity})` : ''}`,
          amount: total,
          is_taxable,
        });
      }
    }

    if (plan?.id !== 2) {
      for (const [key, dbId, singular] of [
        ['mattressDisposal', 4, 'Mattress Disposal'],
        ['tvDisposal', 5, 'TV Disposal'],
        ['applianceDisposal', 6, 'Appliance Disposal'],
      ]) {
        const qty = Number(addons?.[key] || 0);
        if (qty > 0) {
          const { price, is_taxable } = meta(dbId);
          items.push({ label: `${singular} (x${qty})`, amount: price * qty, is_taxable });
        }
      }
    }

    let discount = 0;
    if (addons?.coupon?.isValid) {
      const taxableSum = items.filter(i => i.is_taxable).reduce((s, i) => s + i.amount, 0);
      const fullSum = items.reduce((s, i) => s + i.amount, 0);
      if (addons.coupon.discountType === 'fixed') {
        discount = Number(addons.coupon.discountValue || 0);
      } else if (addons.coupon.discountType === 'percentage') {
        discount = (fullSum * Number(addons.coupon.discountValue || 0)) / 100;
      }
      discount = Math.min(discount, taxableSum);
      if (discount > 0) {
        items.push({
          label: `Coupon (${addons.coupon.code || 'Applied'})`,
          amount: -discount,
          is_taxable: true,
        });
      }
    }

    const taxCalc = calculateItemizedTax(items, taxRate);

    return {
      baseRental,
      deliveryFeeFlat,
      mileageCharge,
      insuranceCost,
      drivewayProtectionCost,
      rentEquipmentCost,
      purchaseItemsCost,
      disposalCost,
      discount,
      subtotal: taxCalc.subtotal,
      tax: taxCalc.taxAmount,
      total: taxCalc.total,
      taxRate,
    };
  }, [basePrice, plan, booking, addons, equipmentMeta, taxRate, insurancePrice, drivewayPrice]);

  if (loading || loadingTaxRate || loadingInsurancePrice || loadingDrivewayPrice) {
    return <div className="text-center text-gray-400 py-4">Loading price breakdown...</div>;
  }

  // Prepare category items
  const serviceItems = [];
  if (calculatedTotals.baseRental > 0) {
    serviceItems.push({ label: 'Base Rental', amount: calculatedTotals.baseRental });
  }
  if (calculatedTotals.deliveryFeeFlat > 0) {
    serviceItems.push({ label: 'Base Delivery Fee', amount: calculatedTotals.deliveryFeeFlat });
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
      if (!equipmentId || !isValidEquipmentId(equipmentId) || equipmentId === 3 || Number(equipmentId) === 7) return;
      
      const price = Number(equipmentMeta[equipmentId]?.price ?? 0);
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
      const price = Number(equipmentMeta[3]?.price ?? 0);
      const quantity = Number(glovesItem.quantity || 1);
      purchaseItems.push({ 
        label: `Working Gloves (Pair) (x${quantity})`, 
        amount: price * quantity 
      });
    }
  }

  const disposalItems = [];
  if (plan?.id !== 2 && addons?.mattressDisposal && addons.mattressDisposal > 0) {
    const price = Number(equipmentMeta[4]?.price ?? 0);
    disposalItems.push({ 
      label: `Mattress Disposal (x${addons.mattressDisposal})`, 
      amount: price * addons.mattressDisposal 
    });
  }
  if (plan?.id !== 2 && addons?.tvDisposal && addons.tvDisposal > 0) {
    const price = Number(equipmentMeta[5]?.price ?? 0);
    disposalItems.push({ 
      label: `TV Disposal (x${addons.tvDisposal})`, 
      amount: price * addons.tvDisposal 
    });
  }
  if (plan?.id !== 2 && addons?.applianceDisposal && addons.applianceDisposal > 0) {
    const price = Number(equipmentMeta[6]?.price ?? 0);
    disposalItems.push({ 
      label: `Appliance Disposal (x${addons.applianceDisposal})`, 
      amount: price * addons.applianceDisposal 
    });
  }

  const discountItems = [];
  if (calculatedTotals.discount > 0) {
    discountItems.push({ 
      label: `Coupon (${addons.coupon?.code || 'Applied'})`, 
      amount: -calculatedTotals.discount, 
      highlight: true 
    });
  }

  const isDeliveryService = plan?.id === 1 || plan?.id === 4 || (plan?.id === 2 && addons?.deliveryService);

  return (
    <div className={`price-breakdown-container ${className}`}>
      <div className="price-breakdown-scrollable">
        {/* 1. Service Costs */}
        <PriceBreakdownCategory
          icon="📦"
          title="Service Costs"
          items={serviceItems}
        />

        {/* 2. Protection Options */}
        <PriceBreakdownCategory
          icon="🛡️"
          title="Protection Options"
          items={protectionItems}
          showInfoButton={true}
          infoTitle="Protection Options"
          infoDescription="Insurance covers damage to the rental equipment. Driveway protection prevents damage to your property during delivery."
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
            <span className="text-blue-200 font-semibold">Tax ({calculatedTotals.taxRate?.toFixed(2) ?? '7.45'}%)</span>
            <span className="text-white font-bold">${calculatedTotals.tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-lg pt-2 border-t border-white/10">
            <span className="text-white font-bold">Total</span>
            <span className="text-green-400 font-bold">${calculatedTotals.total.toFixed(2)}</span>
          </div>
        </div>

        {/* 8. Landfill/Disposal Fees (For Delivery Services Only) */}
        {showLandfillFees && isDeliveryService && (
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
  );
};