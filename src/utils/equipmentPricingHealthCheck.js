import { supabase } from '@/lib/customSupabaseClient';
import { getPriceForEquipment } from './equipmentPricingIntegration';
import { getConnectionStatus, getActiveSubscriptionCount } from './equipmentPriceSyncManager';
import { isValidEquipmentId, getEquipmentName, getValidEquipmentIds } from './equipmentIdValidator';

/**
 * Equipment Pricing System Health Check Utility
 * Validates numeric equipment IDs (1-7)
 */

/**
 * Check equipment data integrity
 * @returns {Promise<object>} Equipment data check results
 */
async function checkEquipmentData() {
  console.log('[Health Check] Checking equipment data integrity...');
  
  const { data: equipment, error } = await supabase
    .from('equipment')
    .select('id, name, type, price')
    .order('id');

  if (error) {
    return {
      status: 'critical',
      passed: false,
      error: error.message,
      count: 0,
      expected_count: 7,
      issues: ['Failed to fetch equipment data']
    };
  }

  const issues = [];
  const invalidIds = [];
  const validIds = getValidEquipmentIds();
  
  // Check count
  if (equipment.length !== 7) {
    issues.push(`Expected 7 equipment records, found ${equipment.length}`);
  }

  // Validate each equipment record
  equipment.forEach(item => {
    // Check for valid numeric ID (1-7)
    if (!isValidEquipmentId(item.id)) {
      invalidIds.push({
        name: item.name,
        id: item.id,
        reason: 'Invalid equipment ID (expected 1-7)'
      });
    }

    // Check for null values
    if (!item.name) {
      issues.push(`Equipment ${item.id} has null name`);
    }
    if (!item.type) {
      issues.push(`Equipment ${item.name} has null type`);
    }
  });

  const status = issues.length > 0 || invalidIds.length > 0 ? 'critical' : 'healthy';

  return {
    status,
    passed: issues.length === 0 && invalidIds.length === 0,
    count: equipment.length,
    expected_count: 7,
    valid_numeric_ids: equipment.filter(e => isValidEquipmentId(e.id)).length,
    invalid_ids: invalidIds,
    issues,
    equipment_list: equipment,
    expected_ids: validIds
  };
}

/**
 * Check pricing data integrity
 * @returns {Promise<object>} Pricing data check results
 */
async function checkPricingData() {
  console.log('[Health Check] Checking pricing data integrity...');

  const [equipmentResult, pricingResult] = await Promise.all([
    supabase.from('equipment').select('id, name'),
    supabase.from('equipment_pricing').select('*')
  ]);

  if (equipmentResult.error || pricingResult.error) {
    return {
      status: 'critical',
      passed: false,
      error: equipmentResult.error?.message || pricingResult.error?.message,
      issues: ['Failed to fetch pricing data']
    };
  }

  const equipment = equipmentResult.data || [];
  const pricing = pricingResult.data || [];
  
  const issues = [];
  const orphaned = [];
  const missing = [];
  const nullItemTypes = [];
  const invalidPrices = [];

  // Check count
  if (pricing.length !== 7) {
    issues.push(`Expected 7 pricing records, found ${pricing.length}`);
  }

  // Check for orphaned pricing records
  pricing.forEach(priceRecord => {
    const equipmentExists = equipment.find(e => e.id === priceRecord.equipment_id);
    if (!equipmentExists) {
      orphaned.push({
        pricing_id: priceRecord.id,
        equipment_id: priceRecord.equipment_id
      });
    }

    // Check for null item_type
    if (!priceRecord.item_type) {
      nullItemTypes.push({
        equipment_id: priceRecord.equipment_id,
        pricing_id: priceRecord.id
      });
    }

    // Check for invalid prices
    const price = Number(priceRecord.base_price);
    if (isNaN(price) || price < 0) {
      invalidPrices.push({
        equipment_id: priceRecord.equipment_id,
        price: priceRecord.base_price
      });
    }
  });

  // Check for missing pricing records
  equipment.forEach(equipmentItem => {
    const pricingExists = pricing.find(p => p.equipment_id === equipmentItem.id);
    if (!pricingExists) {
      missing.push({
        equipment_id: equipmentItem.id,
        equipment_name: equipmentItem.name
      });
    }
  });

  if (orphaned.length > 0) {
    issues.push(`${orphaned.length} orphaned pricing records found`);
  }
  if (missing.length > 0) {
    issues.push(`${missing.length} equipment records missing pricing`);
  }
  if (nullItemTypes.length > 0) {
    issues.push(`${nullItemTypes.length} pricing records have null item_type`);
  }
  if (invalidPrices.length > 0) {
    issues.push(`${invalidPrices.length} pricing records have invalid prices`);
  }

  const status = issues.length > 0 ? 'critical' : 'healthy';

  return {
    status,
    passed: issues.length === 0,
    count: pricing.length,
    expected_count: 7,
    matches: pricing.length - orphaned.length,
    orphaned_count: orphaned.length,
    missing_count: missing.length,
    orphaned_records: orphaned,
    missing_records: missing,
    null_item_types: nullItemTypes,
    invalid_prices: invalidPrices,
    issues
  };
}

/**
 * Validate equipment IDs across system (numeric 1-7)
 * @returns {Promise<object>} Equipment ID validation results
 */
async function validateEquipmentIds() {
  console.log('[Health Check] Validating equipment IDs (expecting numeric 1-7)...');

  const { data: equipment, error } = await supabase
    .from('equipment')
    .select('id, name');

  if (error) {
    return {
      status: 'critical',
      passed: false,
      error: error.message,
      issues: ['Failed to fetch equipment for ID validation']
    };
  }

  const issues = [];
  const invalidIds = [];
  const validIds = getValidEquipmentIds();
  const foundIds = equipment.map(e => e.id);

  // Check for invalid IDs
  equipment.forEach(item => {
    if (!isValidEquipmentId(item.id)) {
      invalidIds.push({
        name: item.name,
        id: item.id,
        reason: 'ID not in valid range (1-7)'
      });
    }
  });

  // Check for missing expected IDs
  const missingIds = validIds.filter(id => !foundIds.includes(id));
  if (missingIds.length > 0) {
    issues.push(`Missing equipment IDs: ${missingIds.join(', ')}`);
  }

  if (invalidIds.length > 0) {
    issues.push(`${invalidIds.length} invalid equipment IDs found (expected 1-7)`);
  }

  const status = issues.length > 0 ? 'critical' : 'healthy';

  return {
    status,
    passed: issues.length === 0,
    expected_ids: validIds,
    found_ids: foundIds,
    missing_ids: missingIds,
    invalid_count: invalidIds.length,
    invalid_ids: invalidIds,
    issues
  };
}

/**
 * Test price lookup functionality
 * @returns {Promise<object>} Price lookup test results
 */
async function testPriceLookups() {
  console.log('[Health Check] Testing price lookup functionality for all equipment (1-7)...');

  const validIds = getValidEquipmentIds();
  const results = [];
  const failures = [];
  const issues = [];

  for (const equipmentId of validIds) {
    try {
      const price = await getPriceForEquipment(equipmentId);
      
      const result = {
        equipment_id: equipmentId,
        equipment_name: getEquipmentName(equipmentId),
        price,
        success: true
      };

      // Validate price
      if (isNaN(price) || price < 0) {
        result.success = false;
        result.error = 'Invalid price value';
        failures.push(result);
        issues.push(`${getEquipmentName(equipmentId)}: Invalid price (${price})`);
      } else if (price === 0) {
        result.warning = 'Price is zero';
      }

      results.push(result);
    } catch (err) {
      const result = {
        equipment_id: equipmentId,
        equipment_name: getEquipmentName(equipmentId),
        success: false,
        error: err.message
      };
      results.push(result);
      failures.push(result);
      issues.push(`${getEquipmentName(equipmentId)}: ${err.message}`);
    }
  }

  const successCount = results.filter(r => r.success).length;
  const status = failures.length === 0 ? 'healthy' : 'critical';

  return {
    status,
    passed: failures.length === 0,
    total_tests: results.length,
    success_count: successCount,
    failure_count: failures.length,
    results,
    failures,
    issues
  };
}

/**
 * Check real-time sync status
 * @returns {object} Real-time sync status
 */
function checkRealtimeSyncStatus() {
  console.log('[Health Check] Checking real-time sync status...');

  const connectionStatus = getConnectionStatus();
  const subscriptionCount = getActiveSubscriptionCount();
  
  const issues = [];
  
  if (connectionStatus !== 'connected') {
    issues.push(`Real-time sync not connected (status: ${connectionStatus})`);
  }

  if (subscriptionCount === 0) {
    issues.push('No active subscriptions');
  }

  const status = issues.length > 0 ? 'warning' : 'healthy';

  return {
    status,
    passed: issues.length === 0,
    connection_status: connectionStatus,
    subscription_count: subscriptionCount,
    connected: connectionStatus === 'connected',
    issues
  };
}

/**
 * Check database connection
 * @returns {Promise<object>} Database connection status
 */
async function checkDatabaseConnection() {
  console.log('[Health Check] Checking database connection...');

  const startTime = Date.now();
  
  try {
    const { data, error } = await supabase
      .from('equipment')
      .select('id')
      .limit(1);

    const latency = Date.now() - startTime;

    if (error) {
      return {
        status: 'critical',
        passed: false,
        connected: false,
        error: error.message,
        issues: ['Database connection failed']
      };
    }

    const { data: pricingData, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('id')
      .limit(1);

    const tablesExist = !pricingError;
    const issues = [];

    if (!tablesExist) {
      issues.push('equipment_pricing table not found');
    }

    if (latency > 1000) {
      issues.push(`High latency: ${latency}ms (expected < 1000ms)`);
    }

    const status = issues.length > 0 ? 'warning' : 'healthy';

    return {
      status,
      passed: issues.length === 0,
      connected: true,
      latency,
      tables_exist: tablesExist,
      issues
    };
  } catch (err) {
    return {
      status: 'critical',
      passed: false,
      connected: false,
      error: err.message,
      issues: ['Database connection error']
    };
  }
}

/**
 * Run complete health check
 * @returns {Promise<object>} Complete health check results
 */
export async function runHealthCheck() {
  console.group('🏥 [System Health Check] Starting comprehensive health check...');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Equipment ID System: Numeric (1-7)');

  const results = {
    timestamp: new Date().toISOString(),
    id_system: 'numeric',
    expected_range: '1-7',
    overall_status: 'unknown',
    checks: {
      equipment_data: null,
      pricing_data: null,
      equipment_ids: null,
      price_lookups: null,
      realtime_sync: null,
      database_connection: null
    },
    summary: {
      total_checks: 6,
      passed: 0,
      failed: 0,
      warnings: 0
    },
    recommendations: []
  };

  try {
    const [
      equipmentData,
      pricingData,
      equipmentIds,
      priceLookups,
      realtimeSync,
      databaseConnection
    ] = await Promise.all([
      checkEquipmentData(),
      checkPricingData(),
      validateEquipmentIds(),
      testPriceLookups(),
      Promise.resolve(checkRealtimeSyncStatus()),
      checkDatabaseConnection()
    ]);

    results.checks = {
      equipment_data: equipmentData,
      pricing_data: pricingData,
      equipment_ids: equipmentIds,
      price_lookups: priceLookups,
      realtime_sync: realtimeSync,
      database_connection: databaseConnection
    };

    // Calculate summary
    Object.values(results.checks).forEach(check => {
      if (check.status === 'healthy') {
        results.summary.passed++;
      } else if (check.status === 'warning') {
        results.summary.warnings++;
      } else if (check.status === 'critical') {
        results.summary.failed++;
      }
    });

    // Determine overall status
    if (results.summary.failed > 0) {
      results.overall_status = 'critical';
    } else if (results.summary.warnings > 0) {
      results.overall_status = 'warning';
    } else {
      results.overall_status = 'healthy';
    }

    // Generate recommendations
    if (equipmentData.invalid_ids.length > 0) {
      results.recommendations.push('Fix invalid equipment IDs (must be 1-7)');
    }
    if (pricingData.missing_count > 0) {
      results.recommendations.push(`Create ${pricingData.missing_count} missing pricing records`);
    }
    if (pricingData.orphaned_count > 0) {
      results.recommendations.push(`Remove ${pricingData.orphaned_count} orphaned pricing records`);
    }
    if (realtimeSync.connection_status !== 'connected') {
      results.recommendations.push('Initialize real-time sync connection');
    }
    if (priceLookups.failure_count > 0) {
      results.recommendations.push('Fix price lookup failures');
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 HEALTH CHECK RESULTS');
    console.log('='.repeat(60));
    console.log(`Overall Status: ${getStatusEmoji(results.overall_status)} ${results.overall_status.toUpperCase()}`);
    console.log(`Equipment ID System: Numeric (1-7)`);
    console.log(`Total Checks: ${results.summary.total_checks}`);
    console.log(`✓ Passed: ${results.summary.passed}`);
    console.log(`⚠ Warnings: ${results.summary.warnings}`);
    console.log(`✗ Failed: ${results.summary.failed}`);
    console.log('='.repeat(60));

    if (results.recommendations.length > 0) {
      console.log('\n📋 Recommendations:');
      results.recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}`);
      });
    }

  } catch (error) {
    console.error('❌ Health check error:', error);
    results.overall_status = 'critical';
    results.error = error.message;
  }

  console.groupEnd();
  return results;
}

/**
 * Get quick health status
 * @returns {Promise<object>} Quick health status
 */
export async function getHealthStatus() {
  const fullCheck = await runHealthCheck();
  
  return {
    status: fullCheck.overall_status,
    id_system: 'numeric',
    expected_range: '1-7',
    timestamp: fullCheck.timestamp,
    summary: {
      equipment_count: fullCheck.checks.equipment_data?.count || 0,
      pricing_count: fullCheck.checks.pricing_data?.count || 0,
      sync_connected: fullCheck.checks.realtime_sync?.connected || false,
      database_connected: fullCheck.checks.database_connection?.connected || false,
      passed: fullCheck.summary.passed,
      failed: fullCheck.summary.failed,
      warnings: fullCheck.summary.warnings
    },
    critical_issues: fullCheck.summary.failed,
    recommendations: fullCheck.recommendations
  };
}

/**
 * Generate detailed health report
 * @returns {Promise<object>} Detailed health report
 */
export async function generateHealthReport() {
  const fullCheck = await runHealthCheck();
  
  const report = {
    report_timestamp: new Date().toISOString(),
    id_system: 'numeric',
    expected_id_range: '1-7',
    overall_status: fullCheck.overall_status,
    summary: fullCheck.summary,
    checks: fullCheck.checks,
    recommendations: fullCheck.recommendations
  };

  return report;
}

/**
 * Export health report as JSON
 * @returns {Promise<void>}
 */
export async function exportHealthReport() {
  const report = await generateHealthReport();
  
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `health-report-${new Date().toISOString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  console.log('[Health Check] Report exported successfully');
}

/**
 * Get status emoji
 * @param {string} status - Status string
 * @returns {string} Emoji
 */
function getStatusEmoji(status) {
  switch (status) {
    case 'healthy': return '✅';
    case 'warning': return '⚠️';
    case 'critical': return '❌';
    default: return '❓';
  }
}

// Make health check tools available in browser console
if (typeof window !== 'undefined') {
  window.equipmentHealthCheck = {
    runHealthCheck,
    getHealthStatus,
    generateHealthReport,
    exportHealthReport
  };

  console.log('🏥 Equipment Health Check Tools available at: window.equipmentHealthCheck');
  console.log('📚 Available methods:');
  console.log('  • runHealthCheck() - Run complete health check');
  console.log('  • getHealthStatus() - Get quick status summary');
  console.log('  • generateHealthReport() - Generate detailed report');
  console.log('  • exportHealthReport() - Export report as JSON');
}

export default {
  runHealthCheck,
  getHealthStatus,
  generateHealthReport,
  exportHealthReport
};