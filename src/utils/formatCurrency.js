/**
 * Format a number as currency with proper localization
 * @param {number} amount - The amount to format
 * @param {string} currency - Currency code (default: USD)
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount, currency = 'USD') => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return '$0.00';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

/**
 * Format a number as currency without symbol
 * @param {number} amount - The amount to format
 * @returns {string} Formatted number string
 */
export const formatCurrencyValue = (amount) => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return '0.00';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

/**
 * Parse currency string to number
 * @param {string} currencyString - Currency string like "$1,234.56"
 * @returns {number} Parsed number
 */
export const parseCurrency = (currencyString) => {
  if (!currencyString) return 0;
  return parseFloat(currencyString.replace(/[^0-9.-]+/g, ''));
};