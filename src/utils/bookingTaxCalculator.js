import { calculateTaxAmount } from '@/utils/calculateTaxAmount';
import { equipmentLineAmount, equipmentNumericId } from '@/utils/rentalEquipmentPricing';
import { catalogBaseRental, rentalDaysForPlan } from '@/utils/phoneOrderQuote';
import { evaluateCoupon, resolveRentalDays } from '@/utils/couponRules';

const DISPOSAL_FALLBACK = { 4: 25, 5: 15, 6: 35 };

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const EQUIPMENT_LABELS = {
  1: 'Wheelbarrow',
  2: 'Hand Truck',
  3: 'Working Gloves (Pair)',
  wheelbarrow: 'Wheelbarrow',
  handTruck: 'Hand Truck',
  gloves: 'Working Gloves (Pair)',
};

const resolveEquipmentLabel = (item, equipmentId) =>
  item.label ||
  EQUIPMENT_LABELS[item.id] ||
  EQUIPMENT_LABELS[equipmentId] ||
  `Equipment ${equipmentId}`;

/**
 * Build charge line items for tax calculation.
 */
export function buildBookingLineItems({
  plan,
  addonsData = {},
  equipmentPrices = {},
  equipmentTaxFlags = {},
  serviceTaxFlags = {},
  deliveryService = false,
  insurancePrice = 0,
  insuranceIsTaxable = false,
  drivewayPrice = 0,
  drivewayIsTaxable = true,
  rentalDays = null,
  dropOff = null,
  pickup = null,
  additionalDayPrices = {},
  equipmentTypes = {},
}) {
  const lines = [];
  const basePriceAmount = resolveBaseRentalAmount(plan, { rentalDays, dropOff, pickup });
  const deliveryFeeFlat = Number(addonsData?.deliveryFee ?? 0);
  const tripMileageCost = Number(
    addonsData?.mileageCharge ?? addonsData?.distanceInfo?.mileageFee ?? 0
  );

  if (basePriceAmount > 0) {
    lines.push({
      key: 'base_rental',
      label: 'Base Rental',
      amount: basePriceAmount,
      is_taxable: serviceTaxFlags.is_taxable !== false,
    });
  }

  if (deliveryFeeFlat > 0) {
    lines.push({
      key: 'delivery_fee',
      label: 'Delivery Fee',
      amount: deliveryFeeFlat,
      is_taxable: serviceTaxFlags.delivery_fee_is_taxable !== false,
    });
  }

  if (tripMileageCost > 0) {
    lines.push({
      key: 'mileage',
      label: 'Trip Mileage',
      amount: tripMileageCost,
      is_taxable: serviceTaxFlags.mileage_is_taxable !== false,
    });
  }

  const insuranceCost =
    addonsData?.insurance === 'accept' ? Number(insurancePrice || equipmentPrices[7] || 0) : 0;
  if (insuranceCost > 0) {
    lines.push({
      key: 'insurance',
      label: 'Premium Insurance',
      amount: insuranceCost,
      is_taxable: insuranceIsTaxable === true,
    });
  }

  const drivewayProtectionCost =
    Number(plan?.id) === 1 && addonsData?.drivewayProtection === 'accept'
      ? Number(drivewayPrice || addonsData?.drivewayPriceApplied || 0)
      : 0;
  if (drivewayProtectionCost > 0) {
    lines.push({
      key: 'driveway_protection',
      label: 'Driveway Protection',
      amount: drivewayProtectionCost,
      is_taxable: drivewayIsTaxable !== false,
    });
  }

  if (addonsData?.equipment && Array.isArray(addonsData.equipment)) {
    addonsData.equipment.forEach((item) => {
      const equipmentId = equipmentNumericId(item);
      if (!equipmentId) return;

      const itemTotal = equipmentLineAmount(item, equipmentPrices, {
        rentalDays: item.rentalDays ?? rentalDays ?? addonsData.rentalDays,
        dropOff: dropOff || addonsData.dropOffDate || addonsData.drop_off_date,
        pickup: pickup || addonsData.pickupDate || addonsData.pickup_date,
        additionalDayPrices,
        equipmentTypes,
      });
      if (itemTotal <= 0) return;

      const flag = equipmentTaxFlags[equipmentId];
      lines.push({
        key: `equipment_${equipmentId}`,
        label: resolveEquipmentLabel(item, equipmentId),
        amount: itemTotal,
        is_taxable: flag !== false,
      });
    });
  }

  const addDisposal = (key, label, defaultId) => {
    const qty = Number(addonsData?.[key] || 0);
    if (qty <= 0) return;
    const unitPrice = Number(equipmentPrices[defaultId] || DISPOSAL_FALLBACK[defaultId] || 0);
    const amount = unitPrice * qty;
    if (amount <= 0) return;
    lines.push({
      key,
      label,
      amount,
      is_taxable: equipmentTaxFlags[defaultId] !== false,
    });
  };

  addDisposal('mattressDisposal', 'Mattress Disposal', 4);
  addDisposal('tvDisposal', 'TV Disposal', 5);
  addDisposal('applianceDisposal', 'Appliance Disposal', 6);

  return lines;
}

/**
 * Apply coupon discount proportionally across line items.
 */
export function allocateDiscount(lineItems, discount) {
  const d = Math.max(0, Number(discount) || 0);
  if (d <= 0 || !lineItems.length) {
    return lineItems.map((line) => ({ ...line, amountAfterDiscount: round2(line.amount) }));
  }

  const grossTotal = lineItems.reduce((sum, l) => sum + l.amount, 0);
  if (grossTotal <= 0) {
    return lineItems.map((line) => ({ ...line, amountAfterDiscount: 0 }));
  }

  let remainingDiscount = d;
  return lineItems.map((line, index) => {
    let lineDiscount;
    if (index === lineItems.length - 1) {
      lineDiscount = remainingDiscount;
    } else {
      lineDiscount = round2((line.amount / grossTotal) * d);
      remainingDiscount = round2(remainingDiscount - lineDiscount);
    }
    return {
      ...line,
      amountAfterDiscount: round2(Math.max(0, line.amount - lineDiscount)),
    };
  });
}

/**
 * Compute tax from line items with per-line taxability.
 */
export function calculateTaxFromLineItems(lineItems, taxRate, discount = 0) {
  const discounted = allocateDiscount(lineItems, discount);

  let taxableSubtotal = 0;
  let nonTaxableSubtotal = 0;

  for (const line of discounted) {
    const amt = line.amountAfterDiscount ?? line.amount;
    if (line.is_taxable) {
      taxableSubtotal += amt;
    } else {
      nonTaxableSubtotal += amt;
    }
  }

  taxableSubtotal = round2(taxableSubtotal);
  nonTaxableSubtotal = round2(nonTaxableSubtotal);
  const subtotalBeforeTax = round2(taxableSubtotal + nonTaxableSubtotal);
  const tax = calculateTaxAmount(taxableSubtotal, taxRate || 0);
  const total = round2(subtotalBeforeTax + tax);

  return {
    lineItems: discounted,
    taxableSubtotal,
    nonTaxableSubtotal,
    subtotalBeforeTax,
    tax,
    total,
    taxRate: taxRate || 0,
  };
}

/**
 * Full booking tax breakdown from plan/addons inputs.
 */
/**
 * Day-adjusted base rental. A plan.price that already differs from the catalog
 * daily rate is a quoted total (checkout or a phone order) and is kept as-is.
 * Otherwise the catalog rate is priced for the rental length.
 */
export function resolveBaseRentalAmount(plan, { rentalDays = null, dropOff = null, pickup = null } = {}) {
  const daily = Number(plan?.base_price) || 0;
  const quoted = Number(plan?.price);
  const hasQuote = Number.isFinite(quoted) && quoted > 0 && quoted !== daily;
  if (hasQuote) return quoted;

  const days = rentalDays != null
    ? Math.max(1, Number(rentalDays) || 1)
    : (dropOff ? rentalDaysForPlan(plan?.id, dropOff, pickup || dropOff) : null);
  if (days != null && daily > 0) return catalogBaseRental(plan, days);
  return quoted > 0 ? quoted : daily;
}

export function calculateBookingTaxBreakdown(options) {
  const { addonsData = {} } = options;
  const lineItems = buildBookingLineItems(options);
  const grossBeforeDiscount = lineItems.reduce((s, l) => s + l.amount, 0);
  const baseRental = lineItems.find((line) => line.key === 'base_rental')?.amount
    ?? resolveBaseRentalAmount(options.plan, options);
  const rentalDays = options.rentalDays
    ?? (options.dropOff
      ? rentalDaysForPlan(options.plan?.id, options.dropOff, options.pickup || options.dropOff)
      : resolveRentalDays(
        addonsData?.dropOffDate || addonsData?.drop_off_date,
        addonsData?.pickupDate || addonsData?.pickup_date,
      ));

  const couponEvaluation = evaluateCoupon({
    coupon: addonsData?.coupon,
    rentalDays,
    baseRental,
    grossBeforeDiscount,
  });
  const loyaltyDiscount = Number(addonsData?.loyaltyDiscountAmount || 0);
  const referralDiscount = Number(addonsData?.referralDiscountAmount || 0);
  const discount = couponEvaluation.discount + loyaltyDiscount + referralDiscount;
  const priced = calculateTaxFromLineItems(lineItems, options.taxRate, discount);

  return {
    ...priced,
    discount,
    couponDiscount: couponEvaluation.discount,
    couponRewards: couponEvaluation.rewards,
    couponAppliedRule: couponEvaluation.appliedRule,
    loyaltyDiscount,
    referralDiscount,
    rentalDays,
  };
}
