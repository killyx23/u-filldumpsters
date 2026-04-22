
import { supabase } from '@/lib/customSupabaseClient';
import { isValidEquipmentId, isNumericEquipmentId } from './equipmentIdValidator';
import { getPriceForEquipment, updateEquipmentPrice } from './equipmentPricingIntegration';

/**
 * Equipment Data Verification Utility
 * Comprehensive validation functions for equipment and pricing data integrity
 */

/**
 * Verify Equipment Table Data
 * Validates all equipment records have valid UUIDs and proper data
 * 
 * @returns {Promise<object>} Validation results
 */
export async function verifyEquipmentTableData() {
  console.group('🔍 [Equipment Table Verification] Starting...');
  
  const report = {
    timestamp: new Date().toISOString(),
    total_records: 0,
    valid_records: [],
    invalid_records: [],
    issues: [],
    passed: false
  };

  try {
    // Query all equipment records
    const { data: equipment, error } = await supabase
      .from('equipment')
      .select('*')
      .order('name');

    if (error) {
      console.error('❌ Failed to fetch equipment:', error);
      report.issues.push(`Database query error: ${error.message}`);
      console.groupEnd();
      return report;
    }

    report.total_records = equipment?.length || 0;
    console.log(`📊 Found ${report.total_records} equipment records`);

    // Validate each record
    equipment?.forEach((item, index) => {
      console.log(`\n[Record ${index + 1}/${report.total_records}] ${item.name}`);
      
      const validationResult = {
        id: item.id,
        name: item.name,
        type: item.type,
        price: item.price,
        service_id_association: item.service_id_association,
        issues: []
      };

      // Check UUID validity
      if (!isValidEquipmentId(item.id)) {
        validationResult.issues.push('Invalid UUID format');
        console.error('  ❌ Invalid UUID:', item.id);
        
        if (isNumericEquipmentId(item.id)) {
          validationResult.issues.push('Legacy numeric ID detected');
          console.error('  ⚠️ Legacy numeric ID detected');
        }
      } else {
        console.log('  ✓ Valid UUID:', item.id);
      }

      // Check required fields
      if (!item.name || item.name.trim() === '') {
        validationResult.issues.push('Missing name');
        console.error('  ❌ Missing name');
      } else {
        console.log('  ✓ Name:', item.name);
      }

      if (!item.type) {
        validationResult.issues.push('Missing type');
        console.error('  ❌ Missing type');
      } else {
        console.log('  ✓ Type:', item.type);
      }

      if (item.price === null || item.price === undefined) {
        validationResult.issues.push('Missing price');
        console.error('  ❌ Missing price');
      } else if (isNaN(Number(item.price))) {
        validationResult.issues.push('Invalid price format');
        console.error('  ❌ Invalid price:', item.price);
      } else {
        console.log('  ✓ Price:', `$${Number(item.price).toFixed(2)}`);
      }

      console.log('  ℹ️ Service ID Association:', item.service_id_association || 'None');
      console.log('  ℹ️ Total Quantity:', item.total_quantity);
      console.log('  ℹ️ Description:', item.description || 'None');

      // Categorize record
      if (validationResult.issues.length === 0) {
        report.valid_records.push(validationResult);
        console.log('  ✅ Record VALID');
      } else {
        report.invalid_records.push(validationResult);
        report.issues.push(`Equipment "${item.name}" (${item.id}): ${validationResult.issues.join(', ')}`);
        console.log('  ❌ Record INVALID');
      }
    });

    // Determine overall status
    report.passed = report.invalid_records.length === 0;

    console.log('\n📋 Verification Summary:');
    console.log(`  Total Records: ${report.total_records}`);
    console.log(`  ✓ Valid: ${report.valid_records.length}`);
    console.log(`  ❌ Invalid: ${report.invalid_records.length}`);
    console.log(`  Overall Status: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);

    if (report.invalid_records.length > 0) {
      console.warn('\n⚠️ Invalid Records:');
      console.table(report.invalid_records);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    report.issues.push(`Fatal error: ${error.message}`);
  }

  console.groupEnd();
  return report;
}

/**
 * Verify Equipment Pricing Table Data
 * Validates pricing records match equipment records and have correct structure
 * 
 * @returns {Promise<object>} Validation results
 */
export async function verifyEquipmentPricingTableData() {
  console.group('🔍 [Equipment Pricing Table Verification] Starting...');
  
  const report = {
    timestamp: new Date().toISOString(),
    total_pricing_records: 0,
    total_equipment_records: 0,
    valid_references: [],
    invalid_references: [],
    orphaned_pricing: [],
    missing_pricing: [],
    null_item_types: [],
    invalid_prices: [],
    issues: [],
    passed: false
  };

  try {
    // Fetch both tables
    const [equipmentResult, pricingResult] = await Promise.all([
      supabase.from('equipment').select('id, name, type'),
      supabase.from('equipment_pricing').select('*')
    ]);

    if (equipmentResult.error) {
      console.error('❌ Failed to fetch equipment:', equipmentResult.error);
      report.issues.push(`Equipment query error: ${equipmentResult.error.message}`);
      console.groupEnd();
      return report;
    }

    if (pricingResult.error) {
      console.error('❌ Failed to fetch pricing:', pricingResult.error);
      report.issues.push(`Pricing query error: ${pricingResult.error.message}`);
      console.groupEnd();
      return report;
    }

    const equipment = equipmentResult.data || [];
    const pricing = pricingResult.data || [];

    report.total_equipment_records = equipment.length;
    report.total_pricing_records = pricing.length;

    console.log(`📊 Equipment Records: ${report.total_equipment_records}`);
    console.log(`📊 Pricing Records: ${report.total_pricing_records}`);

    // Create lookup maps
    const equipmentMap = new Map(equipment.map(e => [e.id, e]));
    const pricingMap = new Map(pricing.map(p => [p.equipment_id, p]));

    // Validate each pricing record
    console.log('\n🔍 Validating Pricing Records:');
    pricing.forEach((price, index) => {
      console.log(`\n[Pricing ${index + 1}/${pricing.length}]`);
      
      const equipId = price.equipment_id;
      const equipmentItem = equipmentMap.get(equipId);

      // Check if equipment_id is valid UUID
      if (!isValidEquipmentId(equipId)) {
        report.invalid_references.push({
          pricing_id: price.id,
          equipment_id: equipId,
          reason: 'Invalid UUID format'
        });
        report.issues.push(`Pricing record ${price.id} has invalid equipment_id: ${equipId}`);
        console.error('  ❌ Invalid UUID format:', equipId);
        return;
      }

      console.log('  ✓ Valid UUID:', equipId);

      // Check if equipment exists
      if (!equipmentItem) {
        report.orphaned_pricing.push({
          pricing_id: price.id,
          equipment_id: equipId,
          base_price: price.base_price
        });
        report.issues.push(`Orphaned pricing record: equipment_id ${equipId} not found in equipment table`);
        console.error('  ❌ Equipment not found - ORPHANED RECORD');
      } else {
        report.valid_references.push(equipId);
        console.log('  ✓ Equipment found:', equipmentItem.name);
      }

      // Check item_type
      if (!price.item_type) {
        report.null_item_types.push({
          pricing_id: price.id,
          equipment_id: equipId,
          equipment_name: equipmentItem?.name
        });
        report.issues.push(`Pricing record for ${equipmentItem?.name || equipId} has null item_type`);
        console.error('  ❌ Null item_type');
      } else {
        console.log('  ✓ Item Type:', price.item_type);
      }

      // Check base_price
      if (price.base_price === null || price.base_price === undefined || isNaN(Number(price.base_price))) {
        report.invalid_prices.push({
          pricing_id: price.id,
          equipment_id: equipId,
          base_price: price.base_price
        });
        report.issues.push(`Invalid price for ${equipmentItem?.name || equipId}: ${price.base_price}`);
        console.error('  ❌ Invalid price:', price.base_price);
      } else {
        console.log('  ✓ Price:', `$${Number(price.base_price).toFixed(2)}`);
      }

      console.log('  ℹ️ Price History Entries:', (price.price_history || []).length);
      console.log('  ℹ️ Last Updated:', price.last_updated || 'Never');
    });

    // Check for missing pricing
    console.log('\n🔍 Checking for Missing Pricing Records:');
    equipment.forEach(equip => {
      if (!pricingMap.has(equip.id)) {
        report.missing_pricing.push({
          equipment_id: equip.id,
          equipment_name: equip.name,
          equipment_type: equip.type
        });
        report.issues.push(`Equipment "${equip.name}" (${equip.id}) missing pricing record`);
        console.error(`  ❌ ${equip.name} - MISSING PRICING`);
      } else {
        console.log(`  ✓ ${equip.name} - has pricing`);
      }
    });

    // Determine overall status
    report.passed = 
      report.invalid_references.length === 0 &&
      report.orphaned_pricing.length === 0 &&
      report.missing_pricing.length === 0 &&
      report.null_item_types.length === 0 &&
      report.invalid_prices.length === 0;

    console.log('\n📋 Verification Summary:');
    console.log(`  Total Pricing Records: ${report.total_pricing_records}`);
    console.log(`  ✓ Valid References: ${report.valid_references.length}`);
    console.log(`  ❌ Invalid References: ${report.invalid_references.length}`);
    console.log(`  ⚠️ Orphaned Records: ${report.orphaned_pricing.length}`);
    console.log(`  ⚠️ Missing Pricing: ${report.missing_pricing.length}`);
    console.log(`  ⚠️ Null Item Types: ${report.null_item_types.length}`);
    console.log(`  ⚠️ Invalid Prices: ${report.invalid_prices.length}`);
    console.log(`  Overall Status: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    report.issues.push(`Fatal error: ${error.message}`);
  }

  console.groupEnd();
  return report;
}

/**
 * Test Price Lookup for All Equipment
 * Validates getPriceForEquipment() works correctly for every equipment item
 * 
 * @returns {Promise<object>} Test results
 */
export async function testPriceLookupForAllEquipment() {
  console.group('🧪 [Price Lookup Test] Testing all equipment...');
  
  const report = {
    timestamp: new Date().toISOString(),
    total_tests: 0,
    passed: 0,
    failed: 0,
    test_results: [],
    issues: []
  };

  try {
    // Fetch all equipment
    const { data: equipment, error } = await supabase
      .from('equipment')
      .select('id, name, type, price')
      .order('name');

    if (error) {
      console.error('❌ Failed to fetch equipment:', error);
      report.issues.push(`Database error: ${error.message}`);
      console.groupEnd();
      return report;
    }

    report.total_tests = equipment?.length || 0;
    console.log(`📊 Testing ${report.total_tests} equipment items\n`);

    // Test each equipment
    for (let i = 0; i < equipment.length; i++) {
      const item = equipment[i];
      console.log(`[Test ${i + 1}/${equipment.length}] ${item.name}`);
      
      const testResult = {
        equipment_id: item.id,
        equipment_name: item.name,
        equipment_type: item.type,
        expected_price: item.price,
        returned_price: null,
        passed: false,
        error: null
      };

      try {
        // Call getPriceForEquipment
        const price = await getPriceForEquipment(item.id);
        testResult.returned_price = price;

        // Verify price was returned
        if (price !== null && price !== undefined && !isNaN(price)) {
          testResult.passed = true;
          report.passed++;
          console.log(`  ✅ PASSED - Price: $${price.toFixed(2)}`);
          
          // Check if price matches equipment table
          if (Number(price) !== Number(item.price)) {
            console.warn(`  ⚠️ Price mismatch - Equipment table: $${Number(item.price).toFixed(2)}, Returned: $${price.toFixed(2)}`);
          }
        } else {
          testResult.passed = false;
          testResult.error = 'Price lookup returned invalid value';
          report.failed++;
          report.issues.push(`${item.name}: Price lookup failed`);
          console.error(`  ❌ FAILED - Invalid price returned: ${price}`);
        }

      } catch (error) {
        testResult.passed = false;
        testResult.error = error.message;
        report.failed++;
        report.issues.push(`${item.name}: ${error.message}`);
        console.error(`  ❌ FAILED - Error: ${error.message}`);
      }

      report.test_results.push(testResult);
    }

    console.log('\n📋 Test Summary:');
    console.log(`  Total Tests: ${report.total_tests}`);
    console.log(`  ✅ Passed: ${report.passed}`);
    console.log(`  ❌ Failed: ${report.failed}`);
    console.log(`  Success Rate: ${((report.passed / report.total_tests) * 100).toFixed(1)}%`);

    if (report.failed > 0) {
      console.error('\n❌ Failed Tests:');
      console.table(report.test_results.filter(t => !t.passed));
    }

  } catch (error) {
    console.error('❌ Test suite error:', error);
    report.issues.push(`Fatal error: ${error.message}`);
  }

  console.groupEnd();
  return report;
}

/**
 * Test Price Update Flow
 * Simulates and verifies a complete price update cycle
 * 
 * @param {string} equipmentId - Optional specific equipment ID to test
 * @returns {Promise<object>} Test results
 */
export async function testPriceUpdateFlow(equipmentId = null) {
  console.group('🧪 [Price Update Flow Test] Starting...');
  
  const report = {
    timestamp: new Date().toISOString(),
    test_equipment: null,
    original_price: null,
    new_price: null,
    update_saved: false,
    price_history_updated: false,
    last_updated_verified: false,
    updated_by_verified: false,
    rollback_successful: false,
    passed: false,
    issues: []
  };

  try {
    // Select equipment to test
    let testEquipment;
    
    if (equipmentId) {
      const { data, error } = await supabase
        .from('equipment')
        .select('*')
        .eq('id', equipmentId)
        .single();
      
      if (error || !data) {
        report.issues.push('Failed to find specified equipment');
        console.error('❌ Equipment not found:', equipmentId);
        console.groupEnd();
        return report;
      }
      
      testEquipment = data;
    } else {
      // Get first equipment item
      const { data, error } = await supabase
        .from('equipment')
        .select('*')
        .limit(1)
        .single();
      
      if (error || !data) {
        report.issues.push('No equipment available for testing');
        console.error('❌ No equipment found');
        console.groupEnd();
        return report;
      }
      
      testEquipment = data;
    }

    report.test_equipment = {
      id: testEquipment.id,
      name: testEquipment.name,
      type: testEquipment.type
    };

    console.log(`📋 Testing with: ${testEquipment.name} (${testEquipment.id})`);

    // Get original price
    report.original_price = await getPriceForEquipment(testEquipment.id);
    console.log(`💰 Original Price: $${report.original_price.toFixed(2)}`);

    // Calculate test price (add $1.00 to original)
    report.new_price = Number(report.original_price) + 1.00;
    console.log(`💰 Test Price: $${report.new_price.toFixed(2)}`);

    // Determine item_type
    const itemType = testEquipment.type === 'consumable' 
      ? 'consumable_item' 
      : testEquipment.type === 'service' 
      ? 'service_item' 
      : 'rental_equipment';

    console.log(`📦 Item Type: ${itemType}`);

    // Step 1: Update price
    console.log('\n🔄 Step 1: Updating price...');
    const updateResult = await updateEquipmentPrice(
      testEquipment.id,
      report.new_price,
      itemType,
      'test-admin',
      'Automated test - price update flow verification'
    );

    if (!updateResult.success) {
      report.issues.push(`Price update failed: ${updateResult.error}`);
      console.error('❌ Update failed:', updateResult.error);
      console.groupEnd();
      return report;
    }

    report.update_saved = true;
    console.log('  ✅ Update saved to database');

    // Step 2: Verify price history
    console.log('\n🔄 Step 2: Verifying price history...');
    const { data: pricingRecord, error: fetchError } = await supabase
      .from('equipment_pricing')
      .select('*')
      .eq('equipment_id', testEquipment.id)
      .single();

    if (fetchError || !pricingRecord) {
      report.issues.push('Failed to fetch updated pricing record');
      console.error('❌ Fetch failed:', fetchError);
    } else {
      console.log('  ✓ Pricing record fetched');
      
      // Check price history
      const history = pricingRecord.price_history || [];
      const latestEntry = history[history.length - 1];
      
      if (latestEntry) {
        console.log('  ✓ Price history exists');
        
        const hasOldPrice = Number(latestEntry.price) === Number(report.original_price);
        const hasNewPrice = Number(latestEntry.new_price) === Number(report.new_price);
        const hasTimestamp = !!latestEntry.changed_at;
        const hasReason = !!latestEntry.change_reason;
        
        if (hasOldPrice && hasNewPrice && hasTimestamp) {
          report.price_history_updated = true;
          console.log('  ✅ Price history correctly updated');
          console.log(`    Old: $${Number(latestEntry.price).toFixed(2)}`);
          console.log(`    New: $${Number(latestEntry.new_price).toFixed(2)}`);
          console.log(`    Timestamp: ${latestEntry.changed_at}`);
          console.log(`    Reason: ${latestEntry.change_reason || 'N/A'}`);
        } else {
          report.issues.push('Price history incomplete or incorrect');
          console.error('  ❌ Price history incomplete');
        }
      } else {
        report.issues.push('No price history entry found');
        console.error('  ❌ No price history entry');
      }

      // Check last_updated
      if (pricingRecord.last_updated) {
        const lastUpdated = new Date(pricingRecord.last_updated);
        const now = new Date();
        const diffMinutes = (now - lastUpdated) / 1000 / 60;
        
        if (diffMinutes < 5) {
          report.last_updated_verified = true;
          console.log('  ✅ last_updated timestamp is current');
        } else {
          report.issues.push('last_updated timestamp is too old');
          console.error('  ❌ last_updated timestamp not current');
        }
      } else {
        report.issues.push('last_updated timestamp missing');
        console.error('  ❌ last_updated missing');
      }

      // Check updated_by
      if (pricingRecord.updated_by) {
        report.updated_by_verified = true;
        console.log('  ✅ updated_by is set:', pricingRecord.updated_by);
      } else {
        console.warn('  ⚠️ updated_by not set (optional)');
      }
    }

    // Step 3: Rollback to original price
    console.log('\n🔄 Step 3: Rolling back to original price...');
    const rollbackResult = await updateEquipmentPrice(
      testEquipment.id,
      report.original_price,
      itemType,
      'test-admin',
      'Automated test - rollback to original price'
    );

    if (rollbackResult.success) {
      report.rollback_successful = true;
      console.log('  ✅ Rollback successful');
    } else {
      report.issues.push('Rollback failed');
      console.error('  ❌ Rollback failed:', rollbackResult.error);
    }

    // Determine overall result
    report.passed = 
      report.update_saved &&
      report.price_history_updated &&
      report.last_updated_verified &&
      report.rollback_successful;

    console.log('\n📋 Test Summary:');
    console.log(`  Update Saved: ${report.update_saved ? '✅' : '❌'}`);
    console.log(`  Price History Updated: ${report.price_history_updated ? '✅' : '❌'}`);
    console.log(`  Last Updated Verified: ${report.last_updated_verified ? '✅' : '❌'}`);
    console.log(`  Updated By Verified: ${report.updated_by_verified ? '✅' : '⚠️'}`);
    console.log(`  Rollback Successful: ${report.rollback_successful ? '✅' : '❌'}`);
    console.log(`  Overall Status: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);

  } catch (error) {
    console.error('❌ Test error:', error);
    report.issues.push(`Fatal error: ${error.message}`);
  }

  console.groupEnd();
  return report;
}

/**
 * Run all verification tests
 * @returns {Promise<object>} Combined results
 */
export async function runAllVerificationTests() {
  console.group('🚀 [Full Verification Suite] Running all tests...');
  
  const results = {
    timestamp: new Date().toISOString(),
    equipment_table: await verifyEquipmentTableData(),
    pricing_table: await verifyEquipmentPricingTableData(),
    price_lookups: await testPriceLookupForAllEquipment(),
    price_update_flow: await testPriceUpdateFlow(),
    overall_passed: false
  };

  results.overall_passed = 
    results.equipment_table.passed &&
    results.pricing_table.passed &&
    results.price_lookups.passed === results.price_lookups.total_tests &&
    results.price_update_flow.passed;

  console.log('\n🎯 Overall Result:', results.overall_passed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');
  console.groupEnd();
  
  return results;
}

// Make functions available in browser console
if (typeof window !== 'undefined') {
  window.equipmentDataVerification = {
    verifyEquipmentTable: verifyEquipmentTableData,
    verifyPricingTable: verifyEquipmentPricingTableData,
    testPriceLookups: testPriceLookupForAllEquipment,
    testPriceUpdate: testPriceUpdateFlow,
    runAll: runAllVerificationTests
  };
  
  console.log('💡 Equipment Data Verification available at: window.equipmentDataVerification');
  console.log('   Example: window.equipmentDataVerification.runAll()');
}
