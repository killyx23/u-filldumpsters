import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

/**
 * Confirm decline of insurance / driveway protection (shared by booking + reschedule).
 */
export function DeclineWarningDialog({ open, onOpenChange, onConfirm, title, description }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-yellow-400 text-white z-[9999]">
        <DialogHeader>
          <DialogTitle className="flex items-center text-yellow-400 text-2xl">
            <ArrowLeft className="mr-3 h-8 w-8" />
            {typeof title === 'string' ? title : 'Confirm'}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="my-4 text-base">
          {typeof description === 'string' ? description : 'Please confirm your choice.'}
        </DialogDescription>
        <DialogFooter className="gap-2 sm:justify-center">
          <Button
            onClick={() => onOpenChange(false)}
            variant="outline"
            className="border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black interactive-hover"
          >
            Go Back & Accept
          </Button>
          <Button onClick={onConfirm} variant="destructive" className="interactive-hover">
            I Understand & Decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
