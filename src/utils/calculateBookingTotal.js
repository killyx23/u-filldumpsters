import { calculateBookingTaxBreakdown } from '@/utils/bookingTaxCalculator';

/**
 * Full booking total with per-line taxability (insurance non-taxable when configured in DB).
 */
export function calculateBookingTotal(
  plan,
  addonsData = {},
  equipmentPrices = {},
  taxRate = 0,
  deliveryService = false,
  insurancePrice = 0,
  {
    insuranceIsTaxable = false,
    drivewayPrice = 0,
    drivewayIsTaxable = true,
    serviceTaxFlags = {},
    equipmentTaxFlags = {},
  } = {}
) {
  const breakdown = calculateBookingTaxBreakdown({
    plan,
    addonsData,
    equipmentPrices,
    equipmentTaxFlags,
    serviceTaxFlags,
    deliveryService,
    insurancePrice,
    insuranceIsTaxable,
    drivewayPrice,
    drivewayIsTaxable,
    taxRate,
  });

  const lineByKey = Object.fromEntries(
    (breakdown.lineItems || []).map((l) => [l.key, l])
  );

  const insuranceCost = lineByKey.insurance?.amount ?? 0;
  const drivewayProtectionCost = lineByKey.driveway_protection?.amount ?? 0;

  let rentEquipmentCost = 0;
  let purchaseItemsCost = 0;
  (addonsData?.equipment || []).forEach((item) => {
    const equipmentId = item.equipment_id || item.dbId || item.id;
    const key = `equipment_${equipmentId}`;
    const amt = lineByKey[key]?.amount ?? 0;
    if (equipmentId === 3) purchaseItemsCost += amt;
    else rentEquipmentCost += amt;
  });

  const disposalCost =
    (lineByKey.mattressDisposal?.amount ?? 0) +
    (lineByKey.tvDisposal?.amount ?? 0) +
    (lineByKey.applianceDisposal?.amount ?? 0);

  let discount = 0;
  const grossBeforeDiscount = breakdown.lineItems?.reduce((s, l) => s + l.amount, 0) ?? 0;
  if (addonsData?.coupon?.isValid) {
    if (addonsData.coupon.discountType === 'fixed') {
      discount = Number(addonsData.coupon.discountValue || 0);
    } else if (addonsData.coupon.discountType === 'percentage') {
      discount = (grossBeforeDiscount * Number(addonsData.coupon.discountValue || 0)) / 100;
    }
  }

  return {
    basePriceAmount: lineByKey.base_rental?.amount ?? Number(plan?.price || plan?.base_price || 0),
    deliveryFeeFlat: lineByKey.delivery_fee?.amount ?? 0,
    tripMileageCost: lineByKey.mileage?.amount ?? 0,
    insuranceCost,
    drivewayProtectionCost,
    rentEquipmentCost,
    purchaseItemsCost,
    disposalCost,
    discount,
    subtotal: breakdown.subtotalBeforeTax,
    taxableSubtotal: breakdown.taxableSubtotal,
    nonTaxableSubtotal: breakdown.nonTaxableSubtotal,
    tax: breakdown.tax,
    taxRate: breakdown.taxRate,
    total: breakdown.total,
    lineItems: breakdown.lineItems,
  };
}
