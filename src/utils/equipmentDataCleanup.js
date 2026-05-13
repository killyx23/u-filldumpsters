
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Equipment Data Cleanup Utility
 * Validates and cleans up Premium Insurance data separation
 * 
 * Premium Insurance (ID 7) should ONLY exist in services table, NOT equipment/equipment_pricing
 */

const INSURANCE_SERVICE_ID = 7;
const EXCLUDED_EQUIPMENT_IDS = [INSURANCE_SERVICE_ID];

/**
 * Check if equipment_pricing has any entries for equipment_id=7
 * @returns {Promise<object>} Status object
 */
export async function validateEquipmentPricingCleanup() {
  console.log('[Cleanup Validation] Checking equipment_pricing table for ID 7...');
  
  try {
    const { data, error } = await supabase
      .from('equipment_pricing')
      .select('*')
      .eq('equipment_id', INSURANCE_SERVICE_ID);

    if (error) {
      console.error('[Cleanup Validation] Error querying equipment_pricing:', error);
      return { 
        success: false, 
        error: error.message,
        foundEntries: 0 
      };
    }

    const foundCount = data?.length || 0;
    
    if (foundCount > 0) {
      console.warn(`[Cleanup Validation] ⚠️ Found ${foundCount} equipment_pricing entries for ID 7 - SHOULD BE REMOVED`);
      return {
        success: false,
        message: `Found ${foundCount} equipment_pricing entries for equipment_id=7 that should be removed`,
        foundEntries: foundCount,
        entries: data
      };
    } else {
      console.log('[Cleanup Validation] ✓ No equipment_pricing entries found for ID 7 (correct)');
      return {
        success: true,
        message: 'Equipment pricing table is clean - no ID 7 entries',
        foundEntries: 0
      };
    }
  } catch (err) {
    console.error('[Cleanup Validation] Unexpected error:', err);
    return {
      success: false,
      error: err.message,
      foundEntries: 0
    };
  }
}

/**
 * Check services table for Premium Insurance (should exist with correct pricing)
 * @returns {Promise<object>} Status object
 */
export async function validateServicesPremiumInsurance() {
  console.log('[Cleanup Validation] Checking services table for Premium Insurance (ID 7)...');
  
  try {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('id', INSURANCE_SERVICE_ID)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        console.error('[Cleanup Validation] ❌ Premium Insurance service (ID 7) NOT FOUND in services table');
        return {
          success: false,
          message: 'Premium Insurance service (ID 7) does not exist in services table',
          exists: false
        };
      }
      console.error('[Cleanup Validation] Error querying services:', error);
      return {
        success: false,
        error: error.message,
        exists: false
      };
    }

    if (!data) {
      console.error('[Cleanup Validation] ❌ No data returned for Premium Insurance service');
      return {
        success: false,
        message: 'Premium Insurance service exists but no data returned',
        exists: false
      };
    }

    const price = Number(data.base_price || 0);
    const expectedPrice = 13.00;
    const priceCorrect = Math.abs(price - expectedPrice) < 0.01;

    console.log('[Cleanup Validation] Premium Insurance service found:', {
      id: data.id,
      name: data.name,
      base_price: price,
      expected_price: expectedPrice,
      price_correct: priceCorrect
    });

    if (!priceCorrect) {
      console.warn(`[Cleanup Validation] ⚠️ Premium Insurance price is $${price.toFixed(2)}, expected $${expectedPrice.toFixed(2)}`);
    } else {
      console.log('[Cleanup Validation] ✓ Premium Insurance price is correct');
    }

    return {
      success: true,
      exists: true,
      priceCorrect: priceCorrect,
      currentPrice: price,
      expectedPrice: expectedPrice,
      service: data,
      message: priceCorrect 
        ? 'Premium Insurance service configured correctly' 
        : `Premium Insurance exists but price is $${price.toFixed(2)} (expected $${expectedPrice.toFixed(2)})`
    };
  } catch (err) {
    console.error('[Cleanup Validation] Unexpected error:', err);
    return {
      success: false,
      error: err.message,
      exists: false
    };
  }
}

/**
 * Check equipment table for any ID 7 entries
 * @returns {Promise<object>} Status object
 */
export async function validateEquipmentTable() {
  console.log('[Cleanup Validation] Checking equipment table for ID 7...');
  
  try {
    const { data, error } = await supabase
      .from('equipment')
      .select('*')
      .eq('id', INSURANCE_SERVICE_ID);

    if (error) {
      console.error('[Cleanup Validation] Error querying equipment:', error);
      return {
        success: false,
        error: error.message,
        foundEntries: 0
      };
    }

    const foundCount = data?.length || 0;

    if (foundCount > 0) {
      console.warn(`[Cleanup Validation] ⚠️ Found equipment entry with ID 7 - should be removed or marked as service-only`);
      return {
        success: false,
        message: 'Found equipment entry with ID 7 that conflicts with services table',
        foundEntries: foundCount,
        entries: data
      };
    } else {
      console.log('[Cleanup Validation] ✓ No equipment entries found for ID 7 (correct)');
      return {
        success: true,
        message: 'Equipment table is clean - no ID 7 entries',
        foundEntries: 0
      };
    }
  } catch (err) {
    console.error('[Cleanup Validation] Unexpected error:', err);
    return {
      success: false,
      error: err.message,
      foundEntries: 0
    };
  }
}

/**
 * Remove equipment_pricing entries for equipment_id=7 (ADMIN ONLY)
 * @returns {Promise<object>} Cleanup result
 */
export async function cleanupEquipmentPricingTable() {
  console.log('[Cleanup] Removing equipment_pricing entries for equipment_id=7...');
  
  try {
    const { data: before, error: beforeError } = await supabase
      .from('equipment_pricing')
      .select('*')
      .eq('equipment_id', INSURANCE_SERVICE_ID);

    if (beforeError) {
      console.error('[Cleanup] Error checking before state:', beforeError);
      return {
        success: false,
        error: beforeError.message,
        removedCount: 0
      };
    }

    const beforeCount = before?.length || 0;
    console.log(`[Cleanup] Found ${beforeCount} entries to remove`);

    if (beforeCount === 0) {
      console.log('[Cleanup] ✓ No entries to remove (already clean)');
      return {
        success: true,
        message: 'Equipment pricing table already clean',
        removedCount: 0
      };
    }

    // Delete entries
    const { error: deleteError } = await supabase
      .from('equipment_pricing')
      .delete()
      .eq('equipment_id', INSURANCE_SERVICE_ID);

    if (deleteError) {
      console.error('[Cleanup] Error deleting entries:', deleteError);
      return {
        success: false,
        error: deleteError.message,
        removedCount: 0
      };
    }

    console.log(`[Cleanup] ✓ Successfully removed ${beforeCount} equipment_pricing entries for ID 7`);
    
    return {
      success: true,
      message: `Removed ${beforeCount} equipment_pricing entries for equipment_id=7`,
      removedCount: beforeCount
    };
  } catch (err) {
    console.error('[Cleanup] Unexpected error:', err);
    return {
      success: false,
      error: err.message,
      removedCount: 0
    };
  }
}

/**
 * Run full validation and report status
 * @returns {Promise<object>} Complete validation report
 */
export async function runFullValidation() {
  console.log('[Full Validation] Starting Premium Insurance data validation...');
  
  const report = {
    timestamp: new Date().toISOString(),
    checks: {},
    overall: {
      success: true,
      issues: []
    }
  };

  // Check 1: Equipment pricing table
  const equipmentPricingCheck = await validateEquipmentPricingCleanup();
  report.checks.equipmentPricing = equipmentPricingCheck;
  if (!equipmentPricingCheck.success || equipmentPricingCheck.foundEntries > 0) {
    report.overall.success = false;
    report.overall.issues.push('Equipment pricing table has ID 7 entries that should be removed');
  }

  // Check 2: Services table
  const servicesCheck = await validateServicesPremiumInsurance();
  report.checks.services = servicesCheck;
  if (!servicesCheck.success || !servicesCheck.exists) {
    report.overall.success = false;
    report.overall.issues.push('Premium Insurance service (ID 7) missing or misconfigured in services table');
  }
  if (servicesCheck.exists && !servicesCheck.priceCorrect) {
    report.overall.issues.push(`Premium Insurance price incorrect: $${servicesCheck.currentPrice.toFixed(2)} (expected $${servicesCheck.expectedPrice.toFixed(2)})`);
  }

  // Check 3: Equipment table
  const equipmentCheck = await validateEquipmentTable();
  report.checks.equipment = equipmentCheck;
  if (!equipmentCheck.success || equipmentCheck.foundEntries > 0) {
    report.overall.success = false;
    report.overall.issues.push('Equipment table has ID 7 entries that conflict with services table');
  }

  // Summary
  if (report.overall.success && report.overall.issues.length === 0) {
    console.log('[Full Validation] ✓ All checks passed - Premium Insurance data is correctly configured');
    report.overall.message = 'Premium Insurance data is correctly configured - pricing sourced from services table (ID 7, $13.00)';
  } else {
    console.warn('[Full Validation] ⚠️ Issues found:', report.overall.issues);
    report.overall.message = `Found ${report.overall.issues.length} issue(s) that need attention`;
  }

  return report;
}

/**
 * Log validation report to console in readable format
 * @param {object} report - Validation report object
 */
export function logValidationReport(report) {
  console.log('\n=== PREMIUM INSURANCE DATA VALIDATION REPORT ===');
  console.log('Timestamp:', report.timestamp);
  console.log('\nOverall Status:', report.overall.success ? '✓ PASS' : '❌ FAIL');
  
  if (report.overall.issues.length > 0) {
    console.log('\nIssues Found:');
    report.overall.issues.forEach((issue, idx) => {
      console.log(`  ${idx + 1}. ${issue}`);
    });
  }
  
  console.log('\nDetailed Checks:');
  console.log('  Equipment Pricing Table:', report.checks.equipmentPricing?.success ? '✓ Clean' : '❌ Has ID 7 entries');
  console.log('  Services Table:', report.checks.services?.exists ? '✓ Premium Insurance exists' : '❌ Missing');
  if (report.checks.services?.exists) {
    console.log(`    - Price: $${report.checks.services.currentPrice?.toFixed(2)} (Expected: $${report.checks.services.expectedPrice?.toFixed(2)})`);
  }
  console.log('  Equipment Table:', report.checks.equipment?.foundEntries === 0 ? '✓ Clean' : '❌ Has ID 7 entries');
  
  console.log('\nSummary:', report.overall.message);
  console.log('=== END VALIDATION REPORT ===\n');
}
