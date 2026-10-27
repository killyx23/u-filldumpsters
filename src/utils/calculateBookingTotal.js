import { calculateBookingTaxBreakdown } from '@/utils/bookingTaxCalculator';
import { equipmentNumericId } from '@/utils/rentalEquipmentPricing';

/**
 * Full booking total with per-line taxability (exemptions via is_taxable flags).
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
    rentalDays = null,
    dropOff = null,
    pickup = null,
    additionalDayPrices = {},
    equipmentTypes = {},
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
    rentalDays,
    dropOff,
    pickup,
    additionalDayPrices,
    equipmentTypes,
  });

  const lineByKey = Object.fromEntries(
    (breakdown.lineItems || []).map((l) => [l.key, l])
  );

  const insuranceCost = lineByKey.insurance?.amount ?? 0;
  const drivewayProtectionCost = lineByKey.driveway_protection?.amount ?? 0;

  let rentEquipmentCost = 0;
  let purchaseItemsCost = 0;
  (addonsData?.equipment || []).forEach((item) => {
    const equipmentId = equipmentNumericId(item);
    if (!equipmentId) return;
    const amt = lineByKey[`equipment_${equipmentId}`]?.amount ?? 0;
    if (equipmentId === 3) purchaseItemsCost += amt;
    else rentEquipmentCost += amt;
  });

  const disposalCost =
    (lineByKey.mattressDisposal?.amount ?? 0) +
    (lineByKey.tvDisposal?.amount ?? 0) +
    (lineByKey.applianceDisposal?.amount ?? 0);

  const couponDiscount = Number(breakdown.couponDiscount || 0);
  const loyaltyDiscount = Number(breakdown.loyaltyDiscount || 0);
  const referralDiscount = Number(breakdown.referralDiscount || 0);
  const discount = Number(breakdown.discount ?? couponDiscount + loyaltyDiscount + referralDiscount);

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
    couponDiscount,
    couponRewards: breakdown.couponRewards || [],
    couponAppliedRule: breakdown.couponAppliedRule || null,
    loyaltyDiscount,
    referralDiscount,
    subtotal: breakdown.subtotalBeforeTax,
    taxableSubtotal: breakdown.taxableSubtotal,
    nonTaxableSubtotal: breakdown.nonTaxableSubtotal,
    tax: breakdown.tax,
    taxRate: breakdown.taxRate,
    total: breakdown.total,
    lineItems: breakdown.lineItems,
  };
}
