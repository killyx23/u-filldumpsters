
/**
 * Calculate equipment depreciation using various methods
 */

/**
 * Calculate straight-line depreciation
 * @param {number} purchasePrice - Original purchase price
 * @param {number} salvageValue - Estimated salvage value
 * @param {number} usefulLife - Useful life in years
 * @param {number} yearsUsed - Years already used
 * @returns {Object} Depreciation details
 */
export const calculateStraightLineDepreciation = (
  purchasePrice,
  salvageValue = 0,
  usefulLife,
  yearsUsed
) => {
  const annualDepreciation = (purchasePrice - salvageValue) / usefulLife;
  const totalDepreciation = annualDepreciation * yearsUsed;
  const currentValue = Math.max(purchasePrice - totalDepreciation, salvageValue);
  const remainingValue = currentValue - salvageValue;

  return {
    method: 'Straight-Line',
    annualDepreciation,
    totalDepreciation,
    currentValue,
    remainingValue,
    depreciationRate: (annualDepreciation / purchasePrice) * 100,
  };
};

/**
 * Calculate declining balance depreciation
 * @param {number} purchasePrice - Original purchase price
 * @param {number} depreciationRate - Annual depreciation rate (percentage)
 * @param {number} yearsUsed - Years already used
 * @returns {Object} Depreciation details
 */
export const calculateDecliningBalanceDepreciation = (
  purchasePrice,
  depreciationRate,
  yearsUsed
) => {
  let currentValue = purchasePrice;
  let totalDepreciation = 0;

  for (let i = 0; i < yearsUsed; i++) {
    const yearDepreciation = currentValue * (depreciationRate / 100);
    totalDepreciation += yearDepreciation;
    currentValue -= yearDepreciation;
  }

  const annualDepreciation = currentValue * (depreciationRate / 100);

  return {
    method: 'Declining Balance',
    annualDepreciation,
    totalDepreciation,
    currentValue,
    depreciationRate,
  };
};

/**
 * Calculate units of production depreciation (based on usage)
 * @param {number} purchasePrice - Original purchase price
 * @param {number} salvageValue - Estimated salvage value
 * @param {number} totalUnits - Total expected units (miles, hours, etc.)
 * @param {number} unitsUsed - Units already used
 * @returns {Object} Depreciation details
 */
export const calculateUnitsOfProductionDepreciation = (
  purchasePrice,
  salvageValue,
  totalUnits,
  unitsUsed
) => {
  const depreciationPerUnit = (purchasePrice - salvageValue) / totalUnits;
  const totalDepreciation = depreciationPerUnit * unitsUsed;
  const currentValue = Math.max(purchasePrice - totalDepreciation, salvageValue);

  return {
    method: 'Units of Production',
    depreciationPerUnit,
    totalDepreciation,
    currentValue,
    unitsUsed,
    totalUnits,
    remainingUnits: totalUnits - unitsUsed,
  };
};

/**
 * Auto-select best depreciation method based on equipment type
 * @param {Object} equipment - Equipment details
 * @returns {Object} Calculated depreciation
 */
export const calculateDepreciation = (equipment) => {
  const {
    purchase_price,
    purchase_date,
    depreciation_rate,
    equipment_type,
    current_value,
  } = equipment;

  const purchaseDate = new Date(purchase_date);
  const now = new Date();
  const yearsUsed = (now - purchaseDate) / (1000 * 60 * 60 * 24 * 365.25);

  // Use declining balance for vehicles and heavy equipment
  if (equipment_type?.toLowerCase().includes('vehicle') || 
      equipment_type?.toLowerCase().includes('trailer')) {
    return calculateDecliningBalanceDepreciation(
      purchase_price,
      depreciation_rate || 20, // Default 20% per year
      yearsUsed
    );
  }

  // Use straight-line for other equipment
  const salvageValue = purchase_price * 0.1; // 10% salvage value
  const usefulLife = 10; // 10 years default useful life

  return calculateStraightLineDepreciation(
    purchase_price,
    salvageValue,
    usefulLife,
    yearsUsed
  );
};
