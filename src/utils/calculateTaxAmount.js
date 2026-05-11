/**
 * Calculates tax amount based on subtotal and tax rate
 * @param {number} subtotal - The subtotal amount before tax
 * @param {number} taxRate - The tax rate as a percentage (e.g., 7.45 for 7.45%)
 * @returns {number} The calculated tax amount rounded to 2 decimal places
 */
export function calculateTaxAmount(subtotal, taxRate) {
  // Input validation
  if (typeof subtotal !== 'number' || isNaN(subtotal) || subtotal < 0) {
    console.warn('[calculateTaxAmount] Invalid subtotal:', subtotal);
    return 0;
  }

  if (typeof taxRate !== 'number' || isNaN(taxRate) || taxRate < 0) {
    console.warn('[calculateTaxAmount] Invalid tax rate:', taxRate);
    return 0;
  }

  // Calculate tax: subtotal * (tax_rate / 100)
  // Example: $335.00 * (7.45 / 100) = $335.00 * 0.0745 = $24.9575 → $24.96
  const taxAmount = subtotal * (taxRate / 100);
  
  // Round to 2 decimal places using banker's rounding
  return Math.round(taxAmount * 100) / 100;
}

/**
 * Calculates total with tax
 * @param {number} subtotal - The subtotal amount before tax
 * @param {number} taxRate - The tax rate as a percentage
 * @returns {Object} Object with subtotal, tax, and total
 */
export function calculateTotalWithTax(subtotal, taxRate) {
  const validSubtotal = typeof subtotal === 'number' && !isNaN(subtotal) ? subtotal : 0;
  const taxAmount = calculateTaxAmount(validSubtotal, taxRate);
  const total = validSubtotal + taxAmount;

  return {
    subtotal: Math.round(validSubtotal * 100) / 100,
    tax: taxAmount,
    total: Math.round(total * 100) / 100
  };
}

/**
 * Formats currency for display
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return '$0.00';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}