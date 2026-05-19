import { calculateBookingTaxBreakdown } from '@/utils/bookingTaxCalculator';

/**
 * Calculate booking total with taxable / non-taxable line split.
 * @param {Object} plan
 * @param {Object} addonsData
 * @param {Object} equipmentPrices - map equipment_id -> price
 * @param {number} taxRate
 * @param {boolean} deliveryService
 * @param {number} insurancePrice
 * @param {Object} [options] - equipmentTaxFlags, serviceTaxFlags, insuranceIsTaxable, drivewayPrice, drivewayIsTaxable
 */
export const calculateBookingTotal = (
  plan,
  addonsData,
  equipmentPrices,
  taxRate,
  deliveryService = false,
  insurancePrice = 0,
  options = {}
) => {
  const breakdown = calculateBookingTaxBreakdown({
    plan,
    addonsData,
    equipmentPrices,
    taxRate,
    deliveryService,
    insurancePrice,
    equipmentTaxFlags: options.equipmentTaxFlags || {},
    serviceTaxFlags: options.serviceTaxFlags || {},
    insuranceIsTaxable: options.insuranceIsTaxable ?? false,
    drivewayPrice: options.drivewayPrice ?? 0,
    drivewayIsTaxable: options.drivewayIsTaxable ?? true,
  });

  const lineByKey = (key) => breakdown.lineItems.find((l) => l.key === key);

  return {
    basePriceAmount: lineByKey('base_rental')?.amount ?? Number(plan?.price ?? plan?.base_price ?? 0),
    deliveryFeeFlat: lineByKey('delivery_fee')?.amount ?? Number(addonsData?.deliveryFee ?? 0),
    tripMileageCost:
      lineByKey('mileage')?.amount ??
      Number(addonsData?.mileageCharge ?? addonsData?.distanceInfo?.mileageFee ?? 0),
    insuranceCost: lineByKey('insurance')?.amount ?? 0,
    drivewayProtectionCost: lineByKey('driveway_protection')?.amount ?? 0,
    rentEquipmentCost: breakdown.lineItems
      .filter((l) => l.key.startsWith('equipment_') && l.key !== 'equipment_3')
      .reduce((s, l) => s + l.amount, 0),
    purchaseItemsCost: lineByKey('equipment_3')?.amount ?? 0,
    disposalCost: breakdown.lineItems
      .filter((l) =>
        ['mattressDisposal', 'tvDisposal', 'applianceDisposal'].includes(l.key)
      )
      .reduce((s, l) => s + l.amount, 0),
    discount: Math.max(
      0,
      breakdown.lineItems.reduce((s, l) => s + l.amount, 0) - breakdown.subtotalBeforeTax
    ),
    subtotal: breakdown.subtotalBeforeTax,
    taxableSubtotal: breakdown.taxableSubtotal,
    nonTaxableSubtotal: breakdown.nonTaxableSubtotal,
    lineItems: breakdown.lineItems,
    tax: breakdown.tax,
    taxRate: breakdown.taxRate,
    total: breakdown.total,
  };
};
