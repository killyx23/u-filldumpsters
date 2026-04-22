
/**
 * Equipment Pricing Diagnostics Console Formatter
 * Provides professional, well-formatted console output for diagnostic reports
 */

/**
 * Format diagnostic header
 * @returns {string} Formatted header string
 */
export function formatDiagnosticHeader() {
  return `
╔═══════════════════════════════════════════════════════════════╗
║         EQUIPMENT PRICING SYSTEM DIAGNOSTICS                  ║
╚═══════════════════════════════════════════════════════════════╝`;
}

/**
 * Format database status section
 * @param {number} equipmentCount - Total equipment records
 * @param {number} pricingCount - Total pricing records
 * @returns {string} Formatted status section
 */
export function formatDatabaseStatus(equipmentCount, pricingCount) {
  const hasAllPricing = equipmentCount === pricingCount;
  const statusIndicator = hasAllPricing ? '✓' : '❌';
  
  return `
┌─────────────────────────────────────────────────────────────┐
│ 📊 DATABASE STATUS                                          │
├─────────────────────────────────────────────────────────────┤
│ Equipment Records:      ${equipmentCount.toString().padEnd(35)} │
│ Pricing Records:        ${pricingCount.toString().padEnd(35)} │
│ Coverage Status:        ${statusIndicator} ${hasAllPricing ? 'Complete' : `Missing ${equipmentCount - pricingCount} records`}${' '.repeat(35 - (hasAllPricing ? 'Complete'.length : `Missing ${equipmentCount - pricingCount} records`.length))} │
└─────────────────────────────────────────────────────────────┘`;
}

/**
 * Format equipment details section
 * @param {Array} equipmentList - List of equipment records
 * @param {Map} pricingMap - Map of equipment_id to pricing record
 * @returns {string} Formatted equipment details
 */
export function formatEquipmentDetails(equipmentList, pricingMap) {
  if (!equipmentList || equipmentList.length === 0) {
    return '\n🔍 No equipment records found';
  }

  let output = `
┌─────────────────────────────────────────────────────────────┐
│ 🔍 EQUIPMENT DETAILS                                        │
├─────────────────────────────────────────────────────────────┤`;

  equipmentList.slice(0, 10).forEach(equip => {
    const hasPricing = pricingMap && pricingMap.has(equip.id);
    const indicator = hasPricing ? '✓' : '❌';
    const price = hasPricing ? `$${Number(pricingMap.get(equip.id).base_price || 0).toFixed(2)}` : 'No Price';
    const equipIdShort = equip.id.substring(0, 8);
    const name = (equip.name || 'Unknown').substring(0, 20);
    
    output += `\n│ ${indicator} ${equipIdShort}... | ${name.padEnd(20)} | ${price.padEnd(10)} │`;
  });

  if (equipmentList.length > 10) {
    output += `\n│ ... and ${equipmentList.length - 10} more equipment records${' '.repeat(24)} │`;
  }

  output += '\n└─────────────────────────────────────────────────────────────┘';
  
  return output;
}

/**
 * Format issues found section
 * @param {Array} issues - List of issues
 * @returns {string} Formatted issues section
 */
export function formatIssuesFound(issues) {
  if (!issues || issues.length === 0) {
    return '\n✅ No critical issues found!';
  }

  let output = `
┌─────────────────────────────────────────────────────────────┐
│ ❌ ISSUES FOUND (${issues.length})                                        │
├─────────────────────────────────────────────────────────────┤`;

  issues.forEach((issue, index) => {
    const issueText = issue.length > 55 ? issue.substring(0, 52) + '...' : issue;
    output += `\n│ ${(index + 1).toString().padStart(2)}. ${issueText}${' '.repeat(58 - issueText.length)} │`;
  });

  output += '\n└─────────────────────────────────────────────────────────────┘';
  
  return output;
}

/**
 * Format recommendations section
 * @param {Array} recommendations - List of recommendations
 * @returns {string} Formatted recommendations section
 */
export function formatRecommendations(recommendations) {
  if (!recommendations || recommendations.length === 0) {
    return '';
  }

  let output = `
┌─────────────────────────────────────────────────────────────┐
│ ✅ RECOMMENDATIONS                                          │
├─────────────────────────────────────────────────────────────┤`;

  recommendations.forEach((rec, index) => {
    const recText = rec.length > 55 ? rec.substring(0, 52) + '...' : rec;
    output += `\n│ ${(index + 1).toString().padStart(2)}. ${recText}${' '.repeat(58 - recText.length)} │`;
  });

  output += '\n└─────────────────────────────────────────────────────────────┘';
  
  return output;
}

/**
 * Format diagnostic footer
 * @returns {string} Formatted footer string
 */
export function formatDiagnosticFooter() {
  return `
╔═══════════════════════════════════════════════════════════════╗
║ Diagnostic complete - Check above for details                ║
╚═══════════════════════════════════════════════════════════════╝
`;
}

/**
 * Format test results section
 * @param {Array} testResults - Price lookup test results
 * @returns {string} Formatted test results
 */
export function formatTestResults(testResults) {
  if (!testResults || testResults.length === 0) {
    return '\n⚠️ No price lookup tests performed';
  }

  let output = `
┌─────────────────────────────────────────────────────────────┐
│ 🧪 PRICE LOOKUP TESTS                                       │
├─────────────────────────────────────────────────────────────┤`;

  testResults.forEach((result, index) => {
    const indicator = result.price !== null && result.price !== undefined ? '✓' : '❌';
    const equipIdShort = result.equipmentId.substring(0, 8);
    const price = result.price !== null && result.price !== undefined ? `$${Number(result.price).toFixed(2)}` : 'Failed';
    
    output += `\n│ ${indicator} Test ${(index + 1).toString().padStart(2)} | ${equipIdShort}... | ${price.padEnd(15)} │`;
  });

  output += '\n└─────────────────────────────────────────────────────────────┘';
  
  return output;
}

/**
 * Format complete diagnostic report
 * @param {object} diagnosticData - Complete diagnostic data
 * @returns {string} Formatted complete report
 */
export function formatCompleteDiagnosticReport(diagnosticData) {
  const {
    equipment = {},
    pricing = {},
    comparison = {},
    testResults = {},
    issues = [],
    recommendations = []
  } = diagnosticData;

  const pricingMap = new Map(
    (pricing.records || []).map(p => [p.equipment_id, p])
  );

  let report = formatDiagnosticHeader();
  report += formatDatabaseStatus(equipment.total || 0, pricing.total || 0);
  report += formatEquipmentDetails(equipment.records || [], pricingMap);
  report += formatTestResults(testResults.details || []);
  report += formatIssuesFound(issues);
  report += formatRecommendations(recommendations);
  report += formatDiagnosticFooter();

  return report;
}

/**
 * Log diagnostic report to console with styling
 * @param {object} diagnosticData - Complete diagnostic data
 */
export function logDiagnosticReport(diagnosticData) {
  const report = formatCompleteDiagnosticReport(diagnosticData);
  
  // Log with console styling
  console.log('%c' + report, 'color: #00ff00; font-family: monospace; font-size: 12px;');
  
  // Also log raw data for inspection
  console.group('📊 Raw Diagnostic Data (Expandable)');
  console.log('Equipment Records:', diagnosticData.equipment);
  console.log('Pricing Records:', diagnosticData.pricing);
  console.log('Comparison Results:', diagnosticData.comparison);
  console.log('Test Results:', diagnosticData.testResults);
  console.log('Issues:', diagnosticData.issues);
  console.log('Recommendations:', diagnosticData.recommendations);
  console.groupEnd();
}
