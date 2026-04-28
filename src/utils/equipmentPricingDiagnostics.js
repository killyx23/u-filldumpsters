import { supabase } from '@/lib/customSupabaseClient';
import { isValidEquipmentId } from './equipmentIdValidator';
import { getPriceForEquipment } from './equipmentPricingIntegration';

/**
 * Comprehensive Equipment Pricing Diagnostics
 * Identifies issues, validates data integrity, and provides detailed reports
 */

/**
 * Main diagnostic function
 * Runs comprehensive checks on equipment pricing system
 * 
 * @returns {Promise<object>} Diagnostic report
 */
export async function diagnoseEquipmentPricing() {
  console.group('🔍 [Equipment Pricing Diagnostics] Starting Comprehensive Analysis');
  console.log('Timestamp:', new Date().toISOString());
  
  const report = {
    timestamp: new Date().toISOString(),
    equipment: {
      total: 0,
      records: [],
      invalidIds: [],
      sampleIds: []
    },
    pricing: {
      total: 0,
      records: [],
      invalidEquipmentIds: [],
      sampleRecords: []
    },
    comparison: {
      equipmentWithPricing: [],
      equipmentMissingPricing: [],
      orphanedPricingRecords: [],
      matches: 0,
      mismatches: 0
    },
    testResults: {
      tested: [],
      passed: 0,
      failed: 0,
      details: []
    },
    hardcodedReferences: [],
    issues: [],
    recommendations: []
  };

  try {
    // Step 1: Query equipment table
    console.log('\n📋 Step 1: Querying equipment table...');
    const { data: equipmentData, error: equipmentError } = await supabase
      .from('equipment')
      .select('id, name, type, price')
      .order('id');

    if (equipmentError) {
      console.error('❌ Equipment query failed:', equipmentError);
      report.issues.push(`Equipment table query error: ${equipmentError.message}`);
      return report;
    }

    report.equipment.total = equipmentData?.length || 0;
    report.equipment.records = equipmentData || [];
    report.equipment.sampleIds = (equipmentData || []).slice(0, 10).map(e => e.id);

    console.log(`✓ Found ${report.equipment.total} equipment records`);
    console.log('Sample IDs:', report.equipment.sampleIds);
    console.table(equipmentData?.slice(0, 5));

    // Validate equipment IDs
    equipmentData?.forEach(equip => {
      if (!isValidEquipmentId(equip.id)) {
        report.equipment.invalidIds.push({
          id: equip.id,
          name: equip.name,
          type: equip.type,
          reason: 'Invalid UUID format'
        });
        console.warn(`⚠️ Invalid equipment ID found: ${equip.name} (${equip.id})`);
      }
    });

    if (report.equipment.invalidIds.length > 0) {
      report.issues.push(`Found ${report.equipment.invalidIds.length} equipment with invalid UUID format`);
      report.recommendations.push('Migrate numeric equipment IDs to UUID format');
    }

    // Step 2: Query equipment_pricing table
    console.log('\n💰 Step 2: Querying equipment_pricing table...');
    const { data: pricingData, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('*')
      .order('created_at');

    if (pricingError) {
      console.error('❌ Pricing query failed:', pricingError);
      report.issues.push(`Equipment_pricing table query error: ${pricingError.message}`);
    }

    report.pricing.total = pricingData?.length || 0;
    report.pricing.records = pricingData || [];
    report.pricing.sampleRecords = (pricingData || []).slice(0, 10);

    console.log(`✓ Found ${report.pricing.total} pricing records`);
    console.table(pricingData?.slice(0, 5));

    // Validate pricing equipment_ids
    pricingData?.forEach(pricing => {
      if (!isValidEquipmentId(pricing.equipment_id)) {
        report.pricing.invalidEquipmentIds.push({
          pricing_id: pricing.id,
          equipment_id: pricing.equipment_id,
          reason: 'Invalid UUID format'
        });
        console.warn(`⚠️ Invalid equipment_id in pricing: ${pricing.equipment_id}`);
      }
    });

    if (report.pricing.invalidEquipmentIds.length > 0) {
      report.issues.push(`Found ${report.pricing.invalidEquipmentIds.length} pricing records with invalid equipment_id`);
      report.recommendations.push('Clean up or fix invalid equipment_id values in equipment_pricing table');
    }

    // Step 3: Compare tables
    console.log('\n🔄 Step 3: Comparing equipment and pricing tables...');
    
    const equipmentIds = new Set(equipmentData?.map(e => e.id) || []);
    const pricingEquipmentIds = new Set(pricingData?.map(p => p.equipment_id) || []);

    equipmentData?.forEach(equip => {
      if (pricingEquipmentIds.has(equip.id)) {
        report.comparison.equipmentWithPricing.push(equip.id);
        report.comparison.matches++;
      } else {
        report.comparison.equipmentMissingPricing.push({
          id: equip.id,
          name: equip.name,
          type: equip.type,
          price: equip.price
        });
        report.comparison.mismatches++;
        console.warn(`❌ Equipment missing pricing: ${equip.name} (${equip.id})`);
      }
    });

    pricingData?.forEach(pricing => {
      if (!equipmentIds.has(pricing.equipment_id)) {
        report.comparison.orphanedPricingRecords.push({
          pricing_id: pricing.id,
          equipment_id: pricing.equipment_id,
          base_price: pricing.base_price
        });
        console.warn(`⚠️ Orphaned pricing record: equipment_id ${pricing.equipment_id} not found in equipment table`);
      }
    });

    console.log(`✓ ${report.comparison.matches} equipment have pricing`);
    console.log(`❌ ${report.comparison.mismatches} equipment missing pricing`);
    console.log(`⚠️ ${report.comparison.orphanedPricingRecords.length} orphaned pricing records`);

    if (report.comparison.mismatches > 0) {
      report.issues.push(`${report.comparison.mismatches} equipment records are missing pricing`);
      report.recommendations.push('Run equipment pricing migration to create missing pricing records');
    }

    if (report.comparison.orphanedPricingRecords.length > 0) {
      report.issues.push(`${report.comparison.orphanedPricingRecords.length} pricing records reference non-existent equipment`);
      report.recommendations.push('Clean up orphaned pricing records');
    }

    // Step 4: Test price lookups with actual equipment IDs
    console.log('\n🧪 Step 4: Testing price lookups with actual equipment IDs...');
    
    const idsToTest = (equipmentData || []).slice(0, 5).map(e => e.id);
    
    for (const equipId of idsToTest) {
      const testResult = await testPriceLookup(equipId);
      report.testResults.details.push(testResult);
      report.testResults.tested.push(equipId);
      
      if (testResult.price !== null && testResult.price !== undefined) {
        report.testResults.passed++;
        console.log(`✓ Test passed: ${equipId} = $${testResult.price}`);
      } else {
        report.testResults.failed++;
        console.error(`❌ Test failed: ${equipId}`, testResult.error);
      }
    }

    console.log(`Tests: ${report.testResults.passed} passed, ${report.testResults.failed} failed`);

    // Step 5: Search for hardcoded "999" references
    console.log('\n🔍 Step 5: Searching for hardcoded equipment ID references...');
    
    const suspiciousPatterns = await findHardcodedEquipmentIds();
    report.hardcodedReferences = suspiciousPatterns;
    
    if (suspiciousPatterns.length > 0) {
      console.warn(`⚠️ Found ${suspiciousPatterns.length} suspicious hardcoded equipment ID references`);
      suspiciousPatterns.forEach(ref => {
        console.warn(`  - "${ref.value}" in ${ref.location}`);
      });
      report.issues.push(`Found ${suspiciousPatterns.length} hardcoded equipment ID references`);
      report.recommendations.push('Replace hardcoded equipment IDs with actual UUIDs from database');
    }

    // Generate summary
    console.log('\n📊 Diagnostic Summary:');
    console.log('Equipment Records:', report.equipment.total);
    console.log('Pricing Records:', report.pricing.total);
    console.log('Matches:', report.comparison.matches);
    console.log('Issues Found:', report.issues.length);
    console.log('Recommendations:', report.recommendations.length);

    if (report.issues.length === 0) {
      console.log('✅ No critical issues found!');
    } else {
      console.warn('⚠️ Issues detected - see report for details');
      console.table(report.issues);
    }

    if (report.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      report.recommendations.forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec}`);
      });
    }

  } catch (error) {
    console.error('❌ Fatal diagnostic error:', error);
    report.issues.push(`Fatal error: ${error.message}`);
  }

  console.groupEnd();
  return report;
}

/**
 * Verify equipment_pricing table integrity
 * 
 * @returns {Promise<object>} Integrity report
 */
export async function verifyEquipmentPricingIntegrity() {
  console.group('[Equipment Pricing Integrity] Verification');
  
  const report = {
    timestamp: new Date().toISOString(),
    valid: true,
    totalPricingRecords: 0,
    validReferences: 0,
    invalidReferences: [],
    orphanedRecords: [],
    missingPricing: [],
    nullItemTypes: [],
    invalidPrices: [],
    errors: []
  };

  try {
    // Fetch all pricing records
    const { data: allPricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('id, equipment_id, item_type, base_price');

    if (pricingError) {
      report.errors.push(`Pricing fetch error: ${pricingError.message}`);
      report.valid = false;
      console.error('❌ Failed to fetch pricing:', pricingError);
      console.groupEnd();
      return report;
    }

    report.totalPricingRecords = allPricing?.length || 0;
    console.log(`Checking ${report.totalPricingRecords} pricing records...`);

    // Fetch all equipment IDs
    const { data: allEquipment, error: equipError } = await supabase
      .from('equipment')
      .select('id, name');

    if (equipError) {
      report.errors.push(`Equipment fetch error: ${equipError.message}`);
      report.valid = false;
      console.error('❌ Failed to fetch equipment:', equipError);
      console.groupEnd();
      return report;
    }

    const validEquipmentIds = new Set(allEquipment?.map(e => e.id) || []);
    const equipmentMap = new Map(allEquipment?.map(e => [e.id, e.name]) || []);

    // Check each pricing record
    for (const pricing of allPricing || []) {
      // Check equipment_id validity
      if (!isValidEquipmentId(pricing.equipment_id)) {
        report.invalidReferences.push({
          pricing_id: pricing.id,
          equipment_id: pricing.equipment_id,
          reason: 'Invalid UUID format'
        });
        report.valid = false;
        continue;
      }

      // Check if equipment exists
      if (!validEquipmentIds.has(pricing.equipment_id)) {
        report.orphanedRecords.push({
          pricing_id: pricing.id,
          equipment_id: pricing.equipment_id,
          base_price: pricing.base_price
        });
        report.valid = false;
        console.warn(`⚠️ Orphaned: equipment_id ${pricing.equipment_id} not found`);
      } else {
        report.validReferences++;
      }

      // Check item_type
      if (!pricing.item_type) {
        report.nullItemTypes.push({
          pricing_id: pricing.id,
          equipment_id: pricing.equipment_id,
          equipment_name: equipmentMap.get(pricing.equipment_id)
        });
        report.valid = false;
      }

      // Check base_price
      if (pricing.base_price === null || pricing.base_price === undefined || isNaN(Number(pricing.base_price))) {
        report.invalidPrices.push({
          pricing_id: pricing.id,
          equipment_id: pricing.equipment_id,
          base_price: pricing.base_price
        });
        report.valid = false;
      }
    }

    // Check for missing pricing
    for (const equip of allEquipment || []) {
      const hasPricing = (allPricing || []).some(p => p.equipment_id === equip.id);
      if (!hasPricing) {
        report.missingPricing.push({
          equipment_id: equip.id,
          equipment_name: equip.name
        });
        report.valid = false;
      }
    }

    // Summary
    console.log('\n📊 Integrity Check Results:');
    console.log(`Total Pricing Records: ${report.totalPricingRecords}`);
    console.log(`✓ Valid References: ${report.validReferences}`);
    console.log(`❌ Invalid References: ${report.invalidReferences.length}`);
    console.log(`⚠️ Orphaned Records: ${report.orphanedRecords.length}`);
    console.log(`⚠️ Missing Pricing: ${report.missingPricing.length}`);
    console.log(`⚠️ Null Item Types: ${report.nullItemTypes.length}`);
    console.log(`⚠️ Invalid Prices: ${report.invalidPrices.length}`);

    if (report.valid) {
      console.log('✅ All integrity checks passed!');
    } else {
      console.warn('❌ Integrity issues detected');
    }

  } catch (error) {
    console.error('❌ Integrity check error:', error);
    report.errors.push(`Fatal error: ${error.message}`);
    report.valid = false;
  }

  console.groupEnd();
  return report;
}

/**
 * Test price lookup for specific equipment ID
 * 
 * @param {string} equipmentId - Equipment ID to test
 * @returns {Promise<object>} Test results
 */
export async function testPriceLookup(equipmentId) {
  console.group(`[Test Price Lookup] Equipment ID: ${equipmentId}`);
  
  const result = {
    equipmentId,
    isValidFormat: false,
    existsInEquipment: false,
    hasPricing: false,
    price: null,
    error: null,
    details: {}
  };

  try {
    // Check format
    result.isValidFormat = isValidEquipmentId(equipmentId);
    console.log('Format valid:', result.isValidFormat ? '✓' : '❌');
    
    if (!result.isValidFormat) {
      result.error = 'Invalid UUID format';
      console.groupEnd();
      return result;
    }

    // Check equipment existence
    const { data: equipment, error: equipError } = await supabase
      .from('equipment')
      .select('id, name, price')
      .eq('id', equipmentId)
      .single();

    result.existsInEquipment = !!equipment && !equipError;
    console.log('Exists in equipment:', result.existsInEquipment ? '✓' : '❌');
    
    if (equipment) {
      result.details.equipment = {
        name: equipment.name,
        fallback_price: equipment.price
      };
    }

    if (equipError && equipError.code !== 'PGRST116') {
      result.error = `Equipment query error: ${equipError.message}`;
    }

    // Check pricing existence
    const { data: pricing, error: pricingError } = await supabase
      .from('equipment_pricing')
      .select('base_price, item_type')
      .eq('equipment_id', equipmentId)
      .single();

    result.hasPricing = !!pricing && !pricingError;
    console.log('Has pricing:', result.hasPricing ? '✓' : '❌');
    
    if (pricing) {
      result.details.pricing = {
        base_price: pricing.base_price,
        item_type: pricing.item_type
      };
    }

    // Test getPriceForEquipment
    const price = await getPriceForEquipment(equipmentId);
    result.price = price;
    console.log('Price returned:', price !== null && price !== undefined ? `$${price}` : 'null');

    if (price === 0 && equipment?.price > 0) {
      result.error = 'Price lookup returned $0 but equipment has non-zero price';
      console.warn('⚠️ Price mismatch detected');
    }

  } catch (error) {
    console.error('❌ Test error:', error);
    result.error = error.message;
  }

  console.log('Test result:', result);
  console.groupEnd();
  
  return result;
}

/**
 * Find hardcoded equipment ID references
 * Searches for common suspicious patterns
 * 
 * @returns {Promise<Array>} Array of suspicious references
 */
export async function findHardcodedEquipmentIds() {
  console.log('[Hardcoded ID Search] Searching for suspicious patterns...');
  
  const suspiciousReferences = [];
  
  // Common hardcoded patterns to look for
  const patterns = [
    { value: '999', location: 'Insurance pricing (INSURANCE_EQUIPMENT_ID)' },
    { value: '0', location: 'Unknown/placeholder IDs' },
    { value: '1', location: 'Test/default IDs' },
    { value: 'test', location: 'Test equipment IDs' },
    { value: 'placeholder', location: 'Placeholder IDs' }
  ];

  // Note: This is a simplified search - in a real implementation,
  // you'd need to actually scan the codebase files
  // For now, we'll check known locations

  // Check for INSURANCE_EQUIPMENT_ID = 999 in useInsurancePricing
  const knownHardcodedIds = [
    {
      value: '999',
      location: 'src/hooks/useInsurancePricing.js (INSURANCE_EQUIPMENT_ID)',
      description: 'Insurance pricing uses hardcoded ID 999 instead of UUID',
      severity: 'high'
    }
  ];

  suspiciousReferences.push(...knownHardcodedIds);

  if (suspiciousReferences.length > 0) {
    console.warn(`Found ${suspiciousReferences.length} suspicious hardcoded references`);
    console.table(suspiciousReferences);
  } else {
    console.log('No suspicious hardcoded references found');
  }

  return suspiciousReferences;
}

/**
 * Export diagnostic report as JSON
 * 
 * @param {object} report - Diagnostic report
 * @returns {string} JSON string
 */
export function exportDiagnosticReport(report) {
  return JSON.stringify(report, null, 2);
}

/**
 * Quick diagnostic check
 * Runs lightweight checks without full analysis
 * 
 * @returns {Promise<object>} Quick check results
 */
export async function quickDiagnosticCheck() {
  console.log('[Quick Diagnostic] Running quick checks...');
  
  const results = {
    timestamp: new Date().toISOString(),
    equipmentCount: 0,
    pricingCount: 0,
    hasIssues: false,
    issues: []
  };

  try {
    const [equipCount, pricingCount] = await Promise.all([
      supabase.from('equipment').select('id', { count: 'exact', head: true }),
      supabase.from('equipment_pricing').select('id', { count: 'exact', head: true })
    ]);

    results.equipmentCount = equipCount.count || 0;
    results.pricingCount = pricingCount.count || 0;

    if (results.equipmentCount > results.pricingCount) {
      results.hasIssues = true;
      results.issues.push(`${results.equipmentCount - results.pricingCount} equipment missing pricing`);
    }

    console.log('Quick check:', results);
  } catch (error) {
    console.error('Quick check error:', error);
    results.issues.push(error.message);
  }

  return results;
}

// Make functions globally available for console testing
if (typeof window !== 'undefined') {
  window.equipmentDiagnostics = {
    diagnoseEquipmentPricing,
    verifyEquipmentPricingIntegrity,
    testPriceLookup,
    findHardcodedEquipmentIds,
    quickDiagnosticCheck,
    exportDiagnosticReport
  };
  console.log('💡 Equipment diagnostics available at: window.equipmentDiagnostics');
}