import React from 'react';
import {
  DUMP_FLAT_RATE_CHARGE_NOTE,
  includedDumpFlatRateSentence,
  UNAVAILABLE_FEE_TEXT,
} from '@/utils/chargesAndFeesConfig';

/** Flat-rate inclusion sentence with a smaller italic charge note in parentheses. */
export function IncludedDumpFlatRateCopy({ rate, tons, className = '' }) {
  const sentence = includedDumpFlatRateSentence(rate, tons);
  if (sentence === UNAVAILABLE_FEE_TEXT) {
    return <span className={className}>{sentence}</span>;
  }

  return (
    <span className={className}>
      {sentence}{' '}
      <em className="text-[0.85em] opacity-90 font-normal">
        {DUMP_FLAT_RATE_CHARGE_NOTE}
      </em>
    </span>
  );
}
