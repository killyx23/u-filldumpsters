import React, { useState, useEffect, useMemo } from 'react';
import { Info } from 'lucide-react';
import { PriceBreakdownCategory } from '@/components/pricing/PriceBreakdownCategory';
import { getPriceForEquipment } from '@/utils/equipmentPricingIntegration';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';

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
  const [equipmentPrices, setEquipmentPrices] = useState({});
  const [loading, setLoading] = useState(true);

  // Load equipment prices from database
  useEffect(() => {
    const loadPrices = async () => {
      setLoading(true);
      const prices = {};

      try {
        // Load equipment/rental items (IDs 1-3)
        const equipmentIds = [1, 2, 3];
        for (const id of equipmentIds) {
          if (isValidEquipmentId(id)) {
            prices[id] = await getPriceForEquipment(id);
          }
        }

        // Load disposal items (IDs 4-6)
        const disposalIds = [4, 5, 6];
        for (const id of disposalIds) {
          if (isValidEquipmentId(id)) {
            prices[id] = await getPriceForEquipment(id);
          }
        }

        // Load insurance (ID 7)
        if (isValidEquipmentId(7)) {
          prices[7] = await getPriceForEquipment(7);
        }

        setEquipmentPrices(prices);
      } catch (error) {
        console.error('[PriceBreakdown] Error loading prices:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPrices();
  }, []);

  const calculatedTotals = useMemo(() => {
    const baseRental = Number(basePrice || plan?.price || booking?.plan?.base_price || 0);
    const deliveryFeeFlat = Number(addons?.deliveryFee || 0);
    const mileageCharge = Number(addons?.mileageCharge || 0);

    // Protection costs
    const insuranceCost = addons?.insurance === 'accept' ? Number(equipmentPrices[7] || 20) : 0;
    const drivewayProtectionCost = addons?.drivewayProtection === 'accept' ? 15 : 0;

    // Equipment costs
    let rentEquipmentCost = 0;
    let purchaseItemsCost = 0;

    if (addons?.equipment && Array.isArray(addons.equipment)) {
      addons.equipment.forEach(item => {
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
    if (addons?.mattressDisposal && addons.mattressDisposal > 0) {
      disposalCost += Number(equipmentPrices[4] || 25) * addons.mattressDisposal;
    }
    if (addons?.tvDisposal && addons.tvDisposal > 0) {
      disposalCost += Number(equipmentPrices[5] || 15) * addons.tvDisposal;
    }
    if (addons?.applianceDisposal && addons.applianceDisposal > 0) {
      disposalCost += Number(equipmentPrices[6] || 35) * addons.applianceDisposal;
    }

    // Calculate subtotal before discount
    const subtotalBeforeDiscount = baseRental + deliveryFeeFlat + mileageCharge + 
                                    insuranceCost + drivewayProtectionCost + 
                                    rentEquipmentCost + purchaseItemsCost + disposalCost;

    // Apply discount
    let discount = 0;
    if (addons?.coupon?.isValid) {
      if (addons.coupon.discountType === 'fixed') {
        discount = Number(addons.coupon.discountValue || 0);
      } else if (addons.coupon.discountType === 'percentage') {
        discount = (subtotalBeforeDiscount * Number(addons.coupon.discountValue || 0)) / 100;
      }
    }

    const subtotal = Math.max(0, subtotalBeforeDiscount - discount);
    const tax = subtotal * 0.07; // 7% tax
    const total = subtotal + tax;

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
      subtotal,
      tax,
      total
    };
  }, [basePrice, plan, booking, addons, equipmentPrices]);

  if (loading) {
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
            <span className="text-blue-200 font-semibold">Tax (7%)</span>
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