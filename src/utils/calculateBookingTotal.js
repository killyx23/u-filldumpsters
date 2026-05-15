
import { calculateTotalWithTax } from '@/utils/calculateTaxAmount';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';

export const calculateBookingTotal = (plan, addonsData, equipmentPrices, taxRate, deliveryService = false, insurancePrice = 0) => {
  const basePriceAmount = plan?.price || plan?.base_price || 0;
  const deliveryFeeFlat = addonsData?.deliveryFee || 0;
  const tripMileageCost = addonsData?.mileageCharge || addonsData?.distanceInfo?.mileageFee || 0;

  const insuranceCost = addonsData?.insurance === 'accept' ? Number(insurancePrice || equipmentPrices[7] || 0) : 0;
  const isDelivery = plan?.id === 2 && deliveryService;
  const drivewayProtectionCost = (plan?.id === 1 || isDelivery) && addonsData?.drivewayProtection === 'accept' ? 15 : 0;

  let rentEquipmentCost = 0;
  let purchaseItemsCost = 0;

  if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
    addonsData.equipment.forEach(item => {
      const equipmentId = item.equipment_id || item.dbId || item.id;
      if (!equipmentId || !isValidEquipmentId(equipmentId)) return;

      const price = Number(equipmentPrices[equipmentId] || 0);
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
  if (addonsData?.mattressDisposal && addonsData.mattressDisposal > 0) {
    disposalCost += Number(equipmentPrices[4] || 25) * addonsData.mattressDisposal;
  }
  if (addonsData?.tvDisposal && addonsData.tvDisposal > 0) {
    disposalCost += Number(equipmentPrices[5] || 15) * addonsData.tvDisposal;
  }
  if (addonsData?.applianceDisposal && addonsData.applianceDisposal > 0) {
    disposalCost += Number(equipmentPrices[6] || 35) * addonsData.applianceDisposal;
  }

  const subtotalBeforeDiscount = basePriceAmount + deliveryFeeFlat + tripMileageCost +
    insuranceCost + drivewayProtectionCost +
    rentEquipmentCost + purchaseItemsCost + disposalCost;

  let discount = 0;
  if (addonsData?.coupon?.isValid) {
    if (addonsData.coupon.discountType === 'fixed') {
      discount = Number(addonsData.coupon.discountValue || 0);
    } else if (addonsData.coupon.discountType === 'percentage') {
      discount = (subtotalBeforeDiscount * Number(addonsData.coupon.discountValue || 0)) / 100;
    }
  }

  const subtotal = Math.max(0, subtotalBeforeDiscount - discount);
  const taxCalc = calculateTotalWithTax(subtotal, taxRate || 0);

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
    taxRate: taxRate || 0,
    total: taxCalc.total
  };
};
