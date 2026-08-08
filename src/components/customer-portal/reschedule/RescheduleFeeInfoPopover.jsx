import React from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useChargesAndFees } from '@/hooks/useChargesAndFees';
import { formatPercent } from '@/utils/chargesAndFeesConfig';

/**
 * Info control explaining possible late reschedule fees from admin Charges & Fees.
 */
export function RescheduleFeeInfoPopover({ className = '' }) {
  const { getFeeMeta } = useChargesAndFees();
  const meta = getFeeMeta('late_reschedule_percentage');
  const pctLabel = formatPercent(meta.fee_value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-7 w-7 text-blue-300 hover:text-white hover:bg-white/10 ${className}`.trim()}
          aria-label={`About ${meta.fee_name}`}
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 bg-gray-950 border-white/15 text-white p-4 shadow-xl"
      >
        <p className="font-semibold text-sm text-blue-200 mb-2">{meta.fee_name}</p>
        <p className="text-xs text-gray-300 leading-relaxed">
          If your reschedule request is submitted within 24 hours of your original appointment, a{' '}
          <span className="text-white font-medium">{meta.fee_name}</span> of{' '}
          <span className="text-yellow-300 font-semibold">up to {pctLabel}%</span> of your original
          booking total may be charged when your request is reviewed and approved. This fee is
          separate from the price difference shown under Final Amount Due / (Credit).
        </p>
      </PopoverContent>
    </Popover>
  );
}
