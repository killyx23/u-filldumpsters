import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { VerificationInfoDialog } from '@/components/VerificationInfoDialog';

export const VerificationInfoTooltip = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-2 shrink-0 rounded-full p-1 text-yellow-400 animate-pulse transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        aria-label="Learn why verification and license plate information is required"
      >
        <Info className="h-5 w-5" />
      </button>
      <VerificationInfoDialog open={open} onOpenChange={setOpen} />
    </>
  );
};
