import React from 'react';
import { useChargesAndFees } from '@/hooks/useChargesAndFees';
import { IncludedDumpFlatRateCopy } from '@/components/IncludedDumpFlatRateCopy';

/**
 * Delivery-only landfill/disposal TBD notice with admin flat-rate inclusion copy.
 * variant: "dark" (checkout / summaries) | "print" (printable receipt)
 */
export function LandfillDisposalFeesNotice({ className = '', variant = 'dark' }) {
  const { fee, loading } = useChargesAndFees();

  const body = loading ? (
    'Pending dump fees are calculated based on actual waste processed.'
  ) : (
    <>
      Pending dump fees are calculated based on actual waste processed.{' '}
      <IncludedDumpFlatRateCopy rate={fee('dump_tonnage_rate')} tons={fee('dump_rate_tons')} />
    </>
  );

  if (variant === 'print') {
    return (
      <div className={className || 'bg-yellow-50 border border-yellow-600 rounded p-2 mt-2'}>
        <p className="font-bold text-sm">🏗️ Landfill/Disposal Fees (TBD)</p>
        <p className="text-xs text-gray-700 mt-1">{body}</p>
      </div>
    );
  }

  return (
    <div className={className || 'bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3 mt-4'}>
      <div className="flex items-start">
        <span className="text-xl mr-2">🏗️</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-yellow-400">Landfill/Disposal Fees (TBD)</p>
          <p className="text-xs text-yellow-200 mt-1">{body}</p>
        </div>
      </div>
    </div>
  );
}
