
import { supabase } from '@/lib/customSupabaseClient';
import { diagnoseEquipmentPricing } from './equipmentPricingDiagnostics';
import { runEquipmentPricingMigration } from './equipmentPricingMigration';

/**
 * Equipment Pricing Auto-Fix Utility
 * Automatically fixes common equipment pricing issues
 */

/**
 * Auto-fix equipment pricing issues
 * @returns {Promise<object>} Fix report
 */
export async function autoFixEquipmentPricing() {
  console.group('[Auto-Fix] Starting equipment pricing auto-fix...');
  
  const report = {
    timestamp: new Date().toISOString(),
    checksPerformed: [],
    fixesApplied: [],
    errors: [],
    success: false
  };

  try {
    // Step 1: Run diagnostic to identify issues
    console.log('[Auto-Fix] Step 1: Running diagnostic scan...');
    report.checksPerformed.push('Diagnostic scan');
    
    const diagnostic = await diagnoseEquipmentPricing();
    
    console.log(`[Auto-Fix] Found ${diagnostic.issues.length} issues`);
    
    if (diagnostic.issues.length === 0) {
      console.log('[Auto-Fix] ✅ No issues found - nothing to fix');
      report.success = true;
      console.groupEnd();
      return report;
    }

    // Step 2: Run migration to create missing pricing records
    if (diagnostic.comparison.mismatches > 0) {
      console.log('[Auto-Fix] Step 2: Creating missing pricing records...');
      report.checksPerformed.push('Create missing pricing records');
      
      const migrationResult = await runEquipmentPricingMigration();
      
      if (migrationResult.success) {
        report.fixesApplied.push(`Created ${migrationResult.created_records} pricing records`);
        console.log(`[Auto-Fix] ✓ Created ${migrationResult.created_records} pricing records`);
      } else {
        report.errors.push(`Migration failed: ${migrationResult.errors} errors`);
        console.error('[Auto-Fix] ❌ Migration failed');
      }
    }

    // Step 3: Fix null item_type values
    console.log('[Auto-Fix] Step 3: Checking for null item_type values...');
    report.checksPerformed.push('Fix null item_type values');
    
    const { data: nullItemTypes, error: nullError } = await supabase
      .from('equipment_pricing')
      .select('id, equipment_id')
      .is('item_type', null);

    if (!nullError && nullItemTypes && nullItemTypes.length > 0) {
      console.log(`[Auto-Fix] Found ${nullItemTypes.length} records with null item_type`);
      
      for (const pricing of nullItemTypes) {
        // Get equipment type
        const { data: equipment } = await supabase
          .from('equipment')
          .select('type')
          .eq('id', pricing.equipment_id)
          .single();

        const itemType = equipment?.type === 'consumable' 
          ? 'consumable_item' 
          : equipment?.type === 'service' 
          ? 'service_item' 
          : 'rental_equipment';

        // Update item_type
        const { error: updateError } = await supabase
          .from('equipment_pricing')
          .update({ item_type: itemType })
          .eq('id', pricing.id);

        if (!updateError) {
          report.fixesApplied.push(`Set item_type to ${itemType} for pricing ${pricing.id}`);
        } else {
          report.errors.push(`Failed to update item_type for pricing ${pricing.id}`);
        }
      }
      
      console.log(`[Auto-Fix] ✓ Fixed ${nullItemTypes.length} null item_type values`);
    }

    // Step 4: Verify fixes were applied
    console.log('[Auto-Fix] Step 4: Verifying fixes...');
    report.checksPerformed.push('Verify fixes');
    
    const finalDiagnostic = await diagnoseEquipmentPricing();
    
    if (finalDiagnostic.issues.length === 0) {
      report.success = true;
      console.log('[Auto-Fix] ✅ All issues fixed successfully!');
    } else {
      report.success = false;
      console.warn(`[Auto-Fix] ⚠️ ${finalDiagnostic.issues.length} issues remain after fixes`);
      report.errors.push(...finalDiagnostic.issues);
    }

    console.log('[Auto-Fix] Summary:');
    console.log(`  Checks: ${report.checksPerformed.length}`);
    console.log(`  Fixes: ${report.fixesApplied.length}`);
    console.log(`  Errors: ${report.errors.length}`);

  } catch (error) {
    console.error('[Auto-Fix] Fatal error:', error);
    report.errors.push(`Fatal error: ${error.message}`);
    report.success = false;
  }

  console.groupEnd();
  return report;
}

/**
 * Check if auto-fix should run
 * @returns {boolean} True if auto-fix should run
 */
export function shouldAutoFix() {
  // Only auto-fix in development mode
  const isDevelopment = import.meta.env.MODE === 'development' || 
                       import.meta.env.DEV === true ||
                       window.location.hostname === 'localhost';

  return isDevelopment;
}

/**
 * Run auto-fix with user confirmation
 * @returns {Promise<object>} Fix report
 */
export async function runAutoFixWithConfirmation() {
  if (!shouldAutoFix()) {
    console.warn('[Auto-Fix] Auto-fix is only available in development mode');
    return { success: false, error: 'Not in development mode' };
  }

  const confirmed = window.confirm(
    'This will automatically fix equipment pricing issues.\n\n' +
    'Actions that will be performed:\n' +
    '• Create missing pricing records\n' +
    '• Fix null item_type values\n' +
    '• Sync price mismatches\n\n' +
    'Continue?'
  );

  if (!confirmed) {
    console.log('[Auto-Fix] User cancelled auto-fix');
    return { success: false, error: 'User cancelled' };
  }

  return await autoFixEquipmentPricing();
}

// Make available globally for console access
if (typeof window !== 'undefined') {
  window.equipmentPricingAutoFix = {
    run: autoFixEquipmentPricing,
    runWithConfirmation: runAutoFixWithConfirmation,
    shouldRun: shouldAutoFix
  };
}
