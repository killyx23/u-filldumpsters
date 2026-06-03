import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PickupLocationInfoDialog } from '@/components/customer-portal/PickupLocationInfoDialog';

export const PickupLocationInfoButton = ({ className }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'shrink-0 rounded-full p-1 text-yellow-400 animate-pulse transition-transform hover:scale-110',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
          className
        )}
        aria-label="Learn about on-demand pickup locations"
      >
        <Info className="h-5 w-5" />
      </button>
      <PickupLocationInfoDialog open={open} onOpenChange={setOpen} />
    </>
  );
};
