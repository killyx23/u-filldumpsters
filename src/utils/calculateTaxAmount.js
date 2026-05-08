/**
 * Calculates tax amount based on subtotal and tax rate.
 *
 * @param {number} subtotal - The subtotal amount before tax
 * @param {number} taxRate - The tax rate as a percentage (e.g., 7.45 for 7.45%)
 * @returns {number} The calculated tax amount rounded to 2 decimal places
 */
export function calculateTaxAmount(subtotal, taxRate) {
  if (typeof subtotal !== 'number' || isNaN(subtotal) || subtotal < 0) {
    console.warn('[calculateTaxAmount] Invalid subtotal:', subtotal);
    return 0;
  }
  if (typeof taxRate !== 'number' || isNaN(taxRate) || taxRate < 0) {
    console.warn('[calculateTaxAmount] Invalid tax rate:', taxRate);
    return 0;
  }
  return Math.round(subtotal * (taxRate / 100) * 100) / 100;
}

/**
 * Calculates total with tax from a simple subtotal (all items assumed taxable).
 * Kept for backward-compatibility. Prefer calculateItemizedTax() for new code.
 *
 * @param {number} subtotal
 * @param {number} taxRate
 * @returns {{ subtotal: number, tax: number, total: number }}
 */
export function calculateTotalWithTax(subtotal, taxRate) {
  const validSubtotal = typeof subtotal === 'number' && !isNaN(subtotal) ? subtotal : 0;
  const taxAmount = calculateTaxAmount(validSubtotal, taxRate);
  return {
    subtotal: Math.round(validSubtotal * 100) / 100,
    tax:      taxAmount,
    total:    Math.round((validSubtotal + taxAmount) * 100) / 100,
  };
}

/**
 * Calculates tax from an array of line items, respecting each item's taxability flag.
 *
 * This is the preferred function for the checkout flow. It separates taxable from
 * non-taxable charges (e.g., insurance is non-taxable in Utah) and applies the
 * correct rate only to taxable items.
 *
 * @param {Array<{ label: string, amount: number, is_taxable: boolean }>} lineItems
 *   Each item must have an `amount` (numeric) and `is_taxable` (boolean) field.
 *   Negative amounts (discounts) should carry is_taxable=true so they reduce the taxable base.
 * @param {number} taxRate - Tax rate as a percentage (e.g., 7.45)
 * @returns {{
 *   taxableSubtotal:    number,
 *   nonTaxableSubtotal: number,
 *   subtotal:           number,
 *   taxAmount:          number,
 *   total:              number,
 *   taxRate:            number,
 * }}
 */
export function calculateItemizedTax(lineItems, taxRate) {
  if (!Array.isArray(lineItems)) {
    console.warn('[calculateItemizedTax] lineItems must be an array');
    return { taxableSubtotal: 0, nonTaxableSubtotal: 0, subtotal: 0, taxAmount: 0, total: 0, taxRate: 0 };
  }

  const validRate = typeof taxRate === 'number' && !isNaN(taxRate) && taxRate >= 0 ? taxRate : 0;

  let taxableSubtotal    = 0;
  let nonTaxableSubtotal = 0;

  for (const item of lineItems) {
    const amount = typeof item.amount === 'number' && !isNaN(item.amount) ? item.amount : 0;
    if (item.is_taxable) {
      taxableSubtotal += amount;
    } else {
      nonTaxableSubtotal += amount;
    }
  }

  // Clamp taxable subtotal at 0 (a large coupon should not create negative tax)
  const clampedTaxable    = Math.max(0, taxableSubtotal);
  const clampedNonTaxable = Math.max(0, nonTaxableSubtotal);

  const taxAmount = Math.round(clampedTaxable * (validRate / 100) * 100) / 100;
  const subtotal  = Math.round((clampedTaxable + clampedNonTaxable) * 100) / 100;
  const total     = Math.round((subtotal + taxAmount) * 100) / 100;

  return {
    taxableSubtotal:    Math.round(clampedTaxable    * 100) / 100,
    nonTaxableSubtotal: Math.round(clampedNonTaxable * 100) / 100,
    subtotal,
    taxAmount,
    total,
    taxRate:  validRate,
  };
}

/**
 * Formats a dollar amount as a USD currency string.
 * @param {number} amount
 * @returns {string}
 */
export function formatCurrency(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style:                 'currency',
    currency:              'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Resolves delivery_type string from plan and deliveryService flag.
 * Centralises the logic that was previously duplicated across components.
 *
 * @param {{ id: number }} plan
 * @param {boolean} deliveryService
 * @returns {'delivery'|'self_service_trailer'|'self_pickup'}
 */
export function resolveDeliveryType(plan, deliveryService) {
  const planId = plan?.id;
  if (planId === 1 || planId === 4) return 'delivery';
  if (planId === 2 && deliveryService) return 'delivery';
  if (planId === 2 && !deliveryService) return 'self_service_trailer';
  return 'delivery'; // default for unknown plan IDs
}
