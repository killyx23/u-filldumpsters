/**
 * Equipment ID Validation Utility
 * Validates equipment IDs to ensure they are valid numeric IDs (1-7)
 */

/**
 * Numeric ID Validation
 * Valid equipment IDs: 1-7 (numeric)
 * 
 * @param {any} id - The ID to validate
 * @returns {boolean} True if valid numeric ID (1-7), false otherwise
 */
export function isValidEquipmentId(id) {
  // Check if id exists
  if (id === null || id === undefined) {
    return false;
  }

  // Convert to number for validation
  const numericId = Number(id);
  
  // Check if it's a valid number
  if (isNaN(numericId)) {
    return false;
  }

  // Check if it's in the valid range (1-7)
  // Equipment IDs: 1=Gorilla Cart, 2=Hand Truck, 3=Gloves, 4=Mattress Disposal, 
  //                5=TV Disposal, 6=Appliance Disposal, 7=Premium Insurance
  return numericId >= 1 && numericId <= 7 && Number.isInteger(numericId);
}

/**
 * Logs equipment ID query for debugging
 * Helps track down where invalid IDs are being used
 * 
 * @param {any} equipmentId - The equipment ID being queried
 * @param {string} context - Description of where the query is happening
 */
export function logEquipmentIdQuery(equipmentId, context) {
  const isValid = isValidEquipmentId(equipmentId);
  
  console.group(`[Equipment ID Query] ${context}`);
  console.log('Equipment ID:', equipmentId);
  console.log('Type:', typeof equipmentId);
  console.log('Numeric Value:', Number(equipmentId));
  console.log('Is Valid (1-7):', isValid);
  
  if (!isValid) {
    console.warn('⚠️ INVALID EQUIPMENT ID DETECTED!');
    console.warn('Expected: Numeric ID between 1-7');
    console.warn('Received:', equipmentId);
    console.trace('Stack trace to identify source:');
  }
  
  console.groupEnd();
  
  return isValid;
}

/**
 * Validates if a value is a numeric equipment ID
 * 
 * @param {any} id - The ID to check
 * @returns {boolean} True if numeric
 */
export function isNumericEquipmentId(id) {
  if (id === null || id === undefined) {
    return false;
  }
  
  const numericValue = Number(id);
  return !isNaN(numericValue) && isFinite(numericValue);
}

/**
 * Get equipment name from ID
 * 
 * @param {number} id - Equipment ID
 * @returns {string} Equipment name
 */
export function getEquipmentName(id) {
  const equipmentNames = {
    1: 'Gorilla Heavy-Duty Dump Cart',
    2: '3-in-1 Convertible Hand Truck',
    3: 'Working Gloves (Pair)',
    4: 'Mattress Disposal',
    5: 'TV Disposal',
    6: 'Appliance Disposal',
    7: 'Premium Insurance'
  };
  
  return equipmentNames[id] || 'Unknown Equipment';
}

/**
 * Validate equipment ID and log if invalid
 * 
 * @param {any} id - Equipment ID
 * @param {string} context - Context for logging
 * @returns {boolean} True if valid
 */
export function validateAndLogEquipmentId(id, context) {
  const isValid = isValidEquipmentId(id);
  
  if (!isValid) {
    console.warn(`[${context}] Invalid equipment ID: ${id} (expected 1-7)`);
  }
  
  return isValid;
}

/**
 * Get all valid equipment IDs
 * 
 * @returns {number[]} Array of valid equipment IDs
 */
export function getValidEquipmentIds() {
  return [1, 2, 3, 4, 5, 6, 7];
}