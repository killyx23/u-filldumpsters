
import { useEffect, useState } from 'react';
import { diagnoseEquipmentPricing, verifyEquipmentPricingIntegrity } from '@/utils/equipmentPricingDiagnostics';
import { logDiagnosticReport } from '@/utils/equipmentPricingDiagnosticsFormatter';

/**
 * Equipment Pricing Diagnostics Hook
 * Runs comprehensive diagnostics on equipment pricing system
 * Only runs in development mode
 * 
 * @param {object} options - Configuration options
 * @param {boolean} options.autoRun - Whether to run diagnostics automatically on mount
 * @param {function} options.onComplete - Callback when diagnostics complete
 * @returns {object} Diagnostic state and controls
 */
export function useEquipmentPricingDiagnostics(options = {}) {
  const { autoRun = true, onComplete } = options;
  
  const [diagnostics, setDiagnostics] = useState({
    loading: false,
    complete: false,
    results: null,
    equipmentCount: 0,
    pricingCount: 0,
    issues: [],
    recommendations: [],
    hasIssues: false
  });

  const runDiagnostics = async () => {
    // Only run in development mode
    const isDevelopment = import.meta.env.MODE === 'development' || 
                         import.meta.env.DEV === true ||
                         window.location.hostname === 'localhost';

    if (!isDevelopment) {
      console.log('[Equipment Diagnostics] Skipping - not in development mode');
      return;
    }

    console.log('[Equipment Diagnostics] Starting diagnostic scan...');
    setDiagnostics(prev => ({ ...prev, loading: true }));

    try {
      // Run comprehensive diagnostics
      const diagnosticResults = await diagnoseEquipmentPricing();
      
      // Run integrity verification
      const integrityResults = await verifyEquipmentPricingIntegrity();

      // Combine results
      const combinedResults = {
        ...diagnosticResults,
        integrity: integrityResults
      };

      // Determine if there are any issues
      const hasIssues = diagnosticResults.issues.length > 0 || !integrityResults.valid;

      // Update state
      setDiagnostics({
        loading: false,
        complete: true,
        results: combinedResults,
        equipmentCount: diagnosticResults.equipment.total,
        pricingCount: diagnosticResults.pricing.total,
        issues: diagnosticResults.issues,
        recommendations: diagnosticResults.recommendations,
        hasIssues
      });

      // Log formatted report to console
      logDiagnosticReport(diagnosticResults);

      // Call completion callback if provided
      if (onComplete) {
        onComplete(combinedResults);
      }

      // Log summary
      if (hasIssues) {
        console.warn(`[Equipment Diagnostics] ⚠️ Found ${diagnosticResults.issues.length} issues`);
        console.warn('[Equipment Diagnostics] See diagnostic report above for details');
      } else {
        console.log('[Equipment Diagnostics] ✅ All checks passed - no issues found');
      }

    } catch (error) {
      console.error('[Equipment Diagnostics] ❌ Diagnostic scan failed:', error);
      
      setDiagnostics(prev => ({
        ...prev,
        loading: false,
        complete: false,
        issues: [`Fatal diagnostic error: ${error.message}`],
        hasIssues: true
      }));
    }
  };

  useEffect(() => {
    if (autoRun) {
      // Run diagnostics after a short delay to allow app to initialize
      const timer = setTimeout(() => {
        runDiagnostics();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [autoRun]);

  return {
    ...diagnostics,
    runDiagnostics,
    refresh: runDiagnostics
  };
}
