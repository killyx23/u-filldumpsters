
/**
 * Equipment Pricing Debug Console
 * Provides browser console access to diagnostic tools
 */

import { 
  diagnoseEquipmentPricing, 
  verifyEquipmentPricingIntegrity, 
  testPriceLookup,
  findHardcodedEquipmentIds,
  exportDiagnosticReport
} from './equipmentPricingDiagnostics';
import { logDiagnosticReport } from './equipmentPricingDiagnosticsFormatter';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Equipment Pricing Debug Console Tools
 * Access via: window.equipmentPricingDebug
 */
const equipmentPricingDebug = {
  /**
   * Run full diagnostic scan
   */
  async runDiagnostics() {
    console.log('🔍 Running full equipment pricing diagnostics...');
    const results = await diagnoseEquipmentPricing();
    logDiagnosticReport(results);
    return results;
  },

  /**
   * Verify data integrity
   */
  async verifyIntegrity() {
    console.log('🔍 Verifying equipment pricing integrity...');
    const results = await verifyEquipmentPricingIntegrity();
    console.log('Integrity Results:', results);
    return results;
  },

  /**
   * Test price lookup for specific equipment ID
   * @param {string} equipmentId - Equipment ID to test
   */
  async testPrice(equipmentId) {
    if (!equipmentId) {
      console.error('❌ Equipment ID required');
      console.log('Usage: equipmentPricingDebug.testPrice("your-equipment-id")');
      return null;
    }

    console.log(`🧪 Testing price lookup for: ${equipmentId}`);
    const result = await testPriceLookup(equipmentId);
    
    if (result.price !== null && result.price !== undefined) {
      console.log(`✓ Test passed - Price: $${result.price}`);
    } else {
      console.error(`❌ Test failed - ${result.error || 'Price lookup failed'}`);
    }
    
    console.log('Full result:', result);
    return result;
  },

  /**
   * List all equipment IDs
   */
  async listEquipment() {
    console.log('📋 Fetching all equipment...');
    const { data, error } = await supabase
      .from('equipment')
      .select('id, name, type, price')
      .order('name');

    if (error) {
      console.error('❌ Failed to fetch equipment:', error);
      return [];
    }

    console.log(`✓ Found ${data.length} equipment records`);
    console.table(data);
    return data;
  },

  /**
   * List all pricing records
   */
  async listPricing() {
    console.log('💰 Fetching all pricing records...');
    const { data, error } = await supabase
      .from('equipment_pricing')
      .select('*')
      .order('created_at');

    if (error) {
      console.error('❌ Failed to fetch pricing:', error);
      return [];
    }

    console.log(`✓ Found ${data.length} pricing records`);
    console.table(data);
    return data;
  },

  /**
   * Find issues in equipment pricing
   */
  async findIssues() {
    console.log('🔍 Searching for issues...');
    const diagnostic = await diagnoseEquipmentPricing();
    
    if (diagnostic.issues.length === 0) {
      console.log('✅ No issues found!');
    } else {
      console.warn(`⚠️ Found ${diagnostic.issues.length} issues:`);
      diagnostic.issues.forEach((issue, i) => {
        console.warn(`  ${i + 1}. ${issue}`);
      });
    }

    return diagnostic.issues;
  },

  /**
   * Generate full diagnostic report
   */
  async generateReport() {
    console.log('📊 Generating diagnostic report...');
    const results = await diagnoseEquipmentPricing();
    logDiagnosticReport(results);
    return results;
  },

  /**
   * Export diagnostic report as JSON
   */
  async exportReport() {
    console.log('📥 Exporting diagnostic report...');
    const results = await diagnoseEquipmentPricing();
    const report = exportDiagnosticReport(results);
    
    console.log('Report exported to variable. Copy the following:');
    console.log(report);
    
    return report;
  },

  /**
   * Find hardcoded equipment ID references
   */
  async findHardcoded() {
    console.log('🔍 Searching for hardcoded equipment IDs...');
    const results = await findHardcodedEquipmentIds();
    
    if (results.length === 0) {
      console.log('✅ No hardcoded references found');
    } else {
      console.warn(`⚠️ Found ${results.length} suspicious references:`);
      console.table(results);
    }

    return results;
  },

  /**
   * Show help information
   */
  help() {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║       EQUIPMENT PRICING DEBUG CONSOLE - HELP                  ║
╚═══════════════════════════════════════════════════════════════╝

Available Commands:
  runDiagnostics()    - Run full diagnostic scan
  verifyIntegrity()   - Check data integrity
  testPrice(id)       - Test price lookup for specific equipment ID
  listEquipment()     - List all equipment records
  listPricing()       - List all pricing records
  findIssues()        - Find and report issues
  generateReport()    - Generate full diagnostic report
  exportReport()      - Export report as JSON
  findHardcoded()     - Search for hardcoded equipment IDs
  help()              - Show this help message

Examples:
  window.equipmentPricingDebug.runDiagnostics()
  window.equipmentPricingDebug.testPrice('your-equipment-id')
  window.equipmentPricingDebug.listEquipment()
  window.equipmentPricingDebug.findIssues()
    `);
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.equipmentPricingDebug = equipmentPricingDebug;
  console.log('%c💡 Equipment Pricing Debug Console Available', 'color: #00ff00; font-weight: bold;');
  console.log('%cAccess via: window.equipmentPricingDebug', 'color: #00aaff;');
  console.log('%cType window.equipmentPricingDebug.help() for available commands', 'color: #ffaa00;');
}

export default equipmentPricingDebug;
