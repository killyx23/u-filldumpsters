import { calculateTaxAmount } from '@/utils/calculateTaxAmount';
import { isValidEquipmentId } from '@/utils/equipmentIdValidator';

const round2 = (n) => Math.round(Number(n) * 100) / 100;

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
}) {
  const lines = [];
  const basePriceAmount = Number(plan?.price ?? plan?.base_price ?? 0);
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

  const isDelivery = plan?.id === 2 && deliveryService;
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
    (plan?.id === 1 || isDelivery) && addonsData?.drivewayProtection === 'accept'
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
      const equipmentId = item.equipment_id || item.dbId || item.id;
      if (!equipmentId || equipmentId === 7 || !isValidEquipmentId(equipmentId)) return;

      const price = Number(equipmentPrices[equipmentId] || 0);
      const quantity = Number(item.quantity || 1);
      const itemTotal = price * quantity;
      if (itemTotal <= 0) return;

      const flag = equipmentTaxFlags[equipmentId];
      lines.push({
        key: `equipment_${equipmentId}`,
        label: item.label || `Equipment ${equipmentId}`,
        amount: itemTotal,
        is_taxable: flag !== false,
      });
    });
  }

  const addDisposal = (key, label, defaultId) => {
    const qty = Number(addonsData?.[key] || 0);
    if (qty <= 0) return;
    const unitPrice = Number(equipmentPrices[defaultId] || 0);
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
export function calculateBookingTaxBreakdown(options) {
  const { addonsData = {} } = options;
  let discount = 0;
  const lineItems = buildBookingLineItems(options);
  const grossBeforeDiscount = lineItems.reduce((s, l) => s + l.amount, 0);

  if (addonsData?.coupon?.isValid) {
    if (addonsData.coupon.discountType === 'fixed') {
      discount = Number(addonsData.coupon.discountValue || 0);
    } else if (addonsData.coupon.discountType === 'percentage') {
      discount = (grossBeforeDiscount * Number(addonsData.coupon.discountValue || 0)) / 100;
    }
  }

  discount += Number(addonsData?.loyaltyDiscountAmount || 0);

  return calculateTaxFromLineItems(lineItems, options.taxRate, discount);
}
