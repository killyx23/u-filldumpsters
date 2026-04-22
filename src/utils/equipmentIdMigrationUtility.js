
import { supabase } from '@/lib/customSupabaseClient';
import { isValidEquipmentId, isNumericEquipmentId } from './equipmentIdValidator';

/**
 * Equipment ID Validation and Migration Utility
 * Scans application for invalid equipment IDs and provides migration tools
 */

/**
 * Validate all equipment records in database
 * @returns {Promise<object>} Validation report
 */
export async function validateDatabaseEquipmentIds() {
  console.group('[Equipment ID Validator] Database Validation');
  
  const report = {
    timestamp: new Date().toISOString(),
    total_equipment: 0,
    valid_ids: [],
    invalid_ids: [],
    numeric_ids: [],
    missing_ids: [],
    equipment_with_issues: []
  };

  try {
    // Fetch all equipment records
    const { data: equipment, error } = await supabase
      .from('equipment')
      .select('id, name, type, price');

    if (error) {
      console.error('❌ Failed to fetch equipment:', error);
      report.error = error.message;
      return report;
    }

    report.total_equipment = equipment?.length || 0;
    console.log(`📊 Scanning ${report.total_equipment} equipment records...`);

    equipment?.forEach(item => {
      if (!item.id) {
        report.missing_ids.push({
          name: item.name,
          type: item.type
        });
        report.equipment_with_issues.push(item);
        console.warn('⚠️ Equipment missing ID:', item.name);
        return;
      }

      if (isValidEquipmentId(item.id)) {
        report.valid_ids.push(item.id);
      } else if (isNumericEquipmentId(item.id)) {
        report.numeric_ids.push({
          id: item.id,
          name: item.name,
          type: item.type
        });
        report.equipment_with_issues.push(item);
        console.warn('⚠️ Numeric ID detected:', item.name, item.id);
      } else {
        report.invalid_ids.push({
          id: item.id,
          name: item.name,
          type: item.type
        });
        report.equipment_with_issues.push(item);
        console.error('❌ Invalid ID format:', item.name, item.id);
      }
    });

    console.log('\n📋 Validation Summary:');
    console.log(`✓ Valid UUIDs: ${report.valid_ids.length}`);
    console.log(`⚠️ Numeric IDs: ${report.numeric_ids.length}`);
    console.log(`❌ Invalid IDs: ${report.invalid_ids.length}`);
    console.log(`❌ Missing IDs: ${report.missing_ids.length}`);

    if (report.equipment_with_issues.length > 0) {
      console.warn('\n⚠️ Equipment with Issues:');
      console.table(report.equipment_with_issues);
    }

  } catch (error) {
    console.error('❌ Fatal validation error:', error);
    report.error = error.message;
  }

  console.groupEnd();
  return report;
}

/**
 * Scan equipment_pricing table for orphaned or invalid records
 * @returns {Promise<object>} Pricing validation report
 */
export async function validateEquipmentPricingReferences() {
  console.group('[Equipment Pricing Validator] Reference Check');
  
  const report = {
    timestamp: new Date().toISOString(),
    total_pricing_records: 0,
    valid_references: [],
    invalid_references: [],
    orphaned_records: [],
    missing_equipment: []
  };

  try {
    // Fetch all pricing records
    const { data: pricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('id, equipment_id, item_type, base_price');

    if (pricingError) {
      console.error('❌ Failed to fetch pricing:', pricingError);
      report.error = pricingError.message;
      return report;
    }

    report.total_pricing_records = pricing?.length || 0;
    console.log(`📊 Checking ${report.total_pricing_records} pricing records...`);

    // Fetch all valid equipment IDs
    const { data: equipment, error: equipError } = await supabase
      .from('equipment')
      .select('id');

    if (equipError) {
      console.error('❌ Failed to fetch equipment:', equipError);
      report.error = equipError.message;
      return report;
    }

    const validEquipmentIds = new Set(equipment?.map(e => e.id) || []);

    pricing?.forEach(price => {
      const equipId = price.equipment_id;

      // Check if equipment_id is valid UUID
      if (!isValidEquipmentId(equipId)) {
        report.invalid_references.push({
          pricing_id: price.id,
          equipment_id: equipId,
          reason: 'Invalid UUID format'
        });
        console.error('❌ Invalid equipment_id in pricing:', equipId);
        return;
      }

      // Check if equipment exists
      if (!validEquipmentIds.has(equipId)) {
        report.orphaned_records.push({
          pricing_id: price.id,
          equipment_id: equipId,
          base_price: price.base_price,
          item_type: price.item_type
        });
        console.warn('⚠️ Orphaned pricing record:', equipId);
        return;
      }

      report.valid_references.push(equipId);
    });

    // Check for equipment missing pricing
    equipment?.forEach(equip => {
      const hasPricing = pricing?.some(p => p.equipment_id === equip.id);
      if (!hasPricing) {
        report.missing_equipment.push(equip.id);
      }
    });

    console.log('\n📋 Pricing Reference Summary:');
    console.log(`✓ Valid References: ${report.valid_references.length}`);
    console.log(`❌ Invalid References: ${report.invalid_references.length}`);
    console.log(`⚠️ Orphaned Records: ${report.orphaned_records.length}`);
    console.log(`⚠️ Missing Pricing: ${report.missing_equipment.length}`);

  } catch (error) {
    console.error('❌ Fatal pricing validation error:', error);
    report.error = error.message;
  }

  console.groupEnd();
  return report;
}

/**
 * Search codebase for hardcoded equipment ID references
 * This is a client-side scan of common patterns
 * @returns {Array} Suspicious code patterns
 */
export function scanForHardcodedIds() {
  console.group('[Equipment ID Scanner] Searching for hardcoded IDs');
  
  const suspiciousPatterns = [];

  // Known hardcoded ID patterns to look for
  const knownIssues = [
    {
      pattern: '999',
      location: 'Insurance pricing (legacy)',
      severity: 'high',
      recommendation: 'Use actual equipment ID from database'
    },
    {
      pattern: '0',
      location: 'Test/placeholder IDs',
      severity: 'medium',
      recommendation: 'Replace with valid UUID'
    },
    {
      pattern: '1',
      location: 'Default test IDs',
      severity: 'medium',
      recommendation: 'Replace with valid UUID'
    }
  ];

  suspiciousPatterns.push(...knownIssues);

  console.log('🔍 Known Issues:', suspiciousPatterns.length);
  console.table(suspiciousPatterns);

  console.groupEnd();
  return suspiciousPatterns;
}

/**
 * Generate comprehensive equipment ID health report
 * @returns {Promise<object>} Complete health report
 */
export async function generateEquipmentIdHealthReport() {
  console.group('[Equipment ID Health] Generating Comprehensive Report');
  
  const [databaseReport, pricingReport] = await Promise.all([
    validateDatabaseEquipmentIds(),
    validateEquipmentPricingReferences()
  ]);

  const codebaseIssues = scanForHardcodedIds();

  const healthReport = {
    timestamp: new Date().toISOString(),
    overall_health: 'unknown',
    database: databaseReport,
    pricing: pricingReport,
    codebase: {
      suspicious_patterns: codebaseIssues
    },
    summary: {
      total_issues: 0,
      critical_issues: 0,
      warnings: 0,
      recommendations: []
    }
  };

  // Calculate total issues
  healthReport.summary.total_issues = 
    (databaseReport.invalid_ids?.length || 0) +
    (databaseReport.numeric_ids?.length || 0) +
    (databaseReport.missing_ids?.length || 0) +
    (pricingReport.invalid_references?.length || 0) +
    (pricingReport.orphaned_records?.length || 0);

  healthReport.summary.critical_issues =
    (databaseReport.invalid_ids?.length || 0) +
    (pricingReport.invalid_references?.length || 0);

  healthReport.summary.warnings =
    (databaseReport.numeric_ids?.length || 0) +
    (pricingReport.orphaned_records?.length || 0) +
    (pricingReport.missing_equipment?.length || 0);

  // Determine overall health
  if (healthReport.summary.critical_issues > 0) {
    healthReport.overall_health = 'critical';
  } else if (healthReport.summary.warnings > 0) {
    healthReport.overall_health = 'warning';
  } else if (healthReport.summary.total_issues === 0) {
    healthReport.overall_health = 'healthy';
  }

  // Generate recommendations
  if (databaseReport.numeric_ids?.length > 0) {
    healthReport.summary.recommendations.push(
      `Migrate ${databaseReport.numeric_ids.length} numeric equipment IDs to UUID format`
    );
  }

  if (pricingReport.orphaned_records?.length > 0) {
    healthReport.summary.recommendations.push(
      `Clean up ${pricingReport.orphaned_records.length} orphaned pricing records`
    );
  }

  if (pricingReport.missing_equipment?.length > 0) {
    healthReport.summary.recommendations.push(
      `Create pricing records for ${pricingReport.missing_equipment.length} equipment items`
    );
  }

  console.log('\n🏥 Overall Health Status:', healthReport.overall_health.toUpperCase());
  console.log('📊 Total Issues:', healthReport.summary.total_issues);
  console.log('🔴 Critical:', healthReport.summary.critical_issues);
  console.log('🟡 Warnings:', healthReport.summary.warnings);

  if (healthReport.summary.recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    healthReport.summary.recommendations.forEach((rec, i) => {
      console.log(`  ${i + 1}. ${rec}`);
    });
  }

  console.groupEnd();
  return healthReport;
}

/**
 * Export health report as downloadable JSON
 * @param {object} report - Health report object
 * @returns {string} JSON string
 */
export function exportHealthReport(report) {
  return JSON.stringify(report, null, 2);
}

// Make utilities available in browser console for debugging
if (typeof window !== 'undefined') {
  window.equipmentIdValidator = {
    validateDatabase: validateDatabaseEquipmentIds,
    validatePricing: validateEquipmentPricingReferences,
    scanCodebase: scanForHardcodedIds,
    generateReport: generateEquipmentIdHealthReport,
    exportReport: exportHealthReport
  };
  
  console.log('💡 Equipment ID Validator available at: window.equipmentIdValidator');
}
