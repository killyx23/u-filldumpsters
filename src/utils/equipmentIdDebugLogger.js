/**
 * Centralized Equipment ID Debug Logger
 * Provides consistent logging functions for equipment ID validation and debugging
 */

// Store debug logs in memory for the session
const sessionLogs = {
  queries: [],
  validations: [],
  calculations: [],
  errors: []
};

/**
 * Log equipment price query
 * @param {string} componentName - Name of component making the query
 * @param {string} equipmentId - Equipment ID being queried
 * @param {number|null} price - Price retrieved (or null if error)
 * @param {Error|null} error - Error if query failed
 */
export function logEquipmentPriceQuery(componentName, equipmentId, price, error = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    componentName,
    equipmentId,
    price,
    error: error?.message || null,
    type: 'price_query'
  };
  
  sessionLogs.queries.push(logEntry);
  
  console.group(`[${componentName}] Equipment Price Query`);
  console.log('Equipment ID:', equipmentId);
  
  if (error) {
    console.error('❌ Error:', error.message);
    console.log('Price:', null);
  } else {
    console.log('✓ Price:', price !== null && price !== undefined ? `$${Number(price).toFixed(2)}` : 'N/A');
  }
  
  console.log('Timestamp:', timestamp);
  console.groupEnd();
  
  return logEntry;
}

/**
 * Log equipment ID validation
 * @param {string} componentName - Name of component validating
 * @param {string} equipmentId - Equipment ID being validated
 * @param {boolean} isValid - Validation result
 * @param {string} stackTrace - Stack trace for invalid IDs
 */
export function logEquipmentIdValidation(componentName, equipmentId, isValid, stackTrace = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    componentName,
    equipmentId,
    isValid,
    stackTrace,
    type: 'validation'
  };
  
  sessionLogs.validations.push(logEntry);
  
  console.group(`[${componentName}] Equipment ID Validation`);
  console.log('Equipment ID:', equipmentId);
  console.log('Is Valid UUID:', isValid ? '✓ YES' : '❌ NO');
  
  if (!isValid) {
    console.warn('⚠️ Invalid equipment ID format detected');
    if (stackTrace) {
      console.trace('Stack trace:', stackTrace);
    }
  }
  
  console.log('Timestamp:', timestamp);
  console.groupEnd();
  
  return logEntry;
}

/**
 * Log equipment calculation
 * @param {string} componentName - Name of component calculating
 * @param {string} equipmentId - Equipment ID
 * @param {number} quantity - Quantity
 * @param {number} price - Unit price
 * @param {number} total - Total cost
 */
export function logEquipmentCalculation(componentName, equipmentId, quantity, price, total) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    componentName,
    equipmentId,
    quantity,
    price,
    total,
    type: 'calculation'
  };
  
  sessionLogs.calculations.push(logEntry);
  
  console.group(`[${componentName}] Equipment Cost Calculation`);
  console.log('Equipment ID:', equipmentId);
  console.log('Quantity:', quantity);
  console.log('Unit Price:', `$${Number(price).toFixed(2)}`);
  console.log('Total Cost:', `$${Number(total).toFixed(2)}`);
  console.log('Timestamp:', timestamp);
  console.groupEnd();
  
  return logEntry;
}

/**
 * Log equipment error
 * @param {string} componentName - Name of component
 * @param {string} equipmentId - Equipment ID
 * @param {string} operation - Operation that failed
 * @param {Error} error - Error object
 */
export function logEquipmentError(componentName, equipmentId, operation, error) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    componentName,
    equipmentId,
    operation,
    error: error.message,
    stack: error.stack,
    type: 'error'
  };
  
  sessionLogs.errors.push(logEntry);
  
  console.group(`[${componentName}] Equipment Error`);
  console.error('Equipment ID:', equipmentId);
  console.error('Operation:', operation);
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  console.log('Timestamp:', timestamp);
  console.groupEnd();
  
  return logEntry;
}

/**
 * Create equipment debug report
 * @returns {object} Comprehensive debug report
 */
export function createEquipmentDebugReport() {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalQueries: sessionLogs.queries.length,
      totalValidations: sessionLogs.validations.length,
      totalCalculations: sessionLogs.calculations.length,
      totalErrors: sessionLogs.errors.length,
      invalidIds: sessionLogs.validations.filter(v => !v.isValid).length,
      failedQueries: sessionLogs.queries.filter(q => q.error).length
    },
    byComponent: {},
    invalidIds: [],
    errors: sessionLogs.errors,
    recentActivity: []
  };
  
  // Group by component
  const allLogs = [
    ...sessionLogs.queries,
    ...sessionLogs.validations,
    ...sessionLogs.calculations,
    ...sessionLogs.errors
  ];
  
  allLogs.forEach(log => {
    if (!report.byComponent[log.componentName]) {
      report.byComponent[log.componentName] = {
        queries: 0,
        validations: 0,
        calculations: 0,
        errors: 0,
        invalidIds: []
      };
    }
    
    report.byComponent[log.componentName][log.type === 'price_query' ? 'queries' : log.type === 'validation' ? 'validations' : log.type === 'calculation' ? 'calculations' : 'errors']++;
    
    if (log.type === 'validation' && !log.isValid) {
      report.byComponent[log.componentName].invalidIds.push(log.equipmentId);
      if (!report.invalidIds.some(id => id.equipmentId === log.equipmentId)) {
        report.invalidIds.push({
          equipmentId: log.equipmentId,
          components: [log.componentName],
          timestamp: log.timestamp
        });
      }
    }
  });
  
  // Recent activity (last 20 entries)
  report.recentActivity = allLogs
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 20);
  
  console.group('[Equipment Debug Report]');
  console.log('Generated:', report.timestamp);
  console.log('Summary:', report.summary);
  console.log('By Component:', report.byComponent);
  if (report.invalidIds.length > 0) {
    console.warn('Invalid IDs Found:', report.invalidIds);
  }
  if (report.errors.length > 0) {
    console.error('Errors:', report.errors);
  }
  console.groupEnd();
  
  return report;
}

/**
 * Clear session logs
 */
export function clearSessionLogs() {
  sessionLogs.queries = [];
  sessionLogs.validations = [];
  sessionLogs.calculations = [];
  sessionLogs.errors = [];
  console.log('[Equipment Debug] Session logs cleared');
}

/**
 * Get session logs
 * @returns {object} Current session logs
 */
export function getSessionLogs() {
  return { ...sessionLogs };
}

/**
 * Export session logs as JSON
 * @returns {string} JSON string of session logs
 */
export function exportSessionLogs() {
  return JSON.stringify(sessionLogs, null, 2);
}