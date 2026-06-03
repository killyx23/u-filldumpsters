import React from 'react';
import { Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export const VerificationInfoDialog = ({ open, onOpenChange }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-yellow-500/50 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-yellow-400 text-xl sm:text-2xl flex items-center gap-2">
            <Info className="h-6 w-6 shrink-0" />
            Why do we need this information?
          </DialogTitle>
          <DialogDescription className="sr-only">
            Why we ask for towing vehicle and verification information.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pr-1">
          <p className="text-sm text-blue-200">
            To ensure the security and proper use of our rental equipment, we require the license plate number of the
            vehicle that will be towing the trailer. This information is crucial for liability and accountability, legal
            compliance, and asset protection.
          </p>
          <ul className="text-sm text-blue-200 space-y-2 list-none">
            <li>
              <strong className="text-yellow-300">Identity Verification:</strong> We must confirm that the individual
              picking up the equipment is the same person who made the reservation.
            </li>
            <li>
              <strong className="text-yellow-300">Fraud Prevention:</strong> Validating your driver&apos;s license helps us
              prevent identity theft and protects both our business and our customers.
            </li>
            <li>
              <strong className="text-yellow-300">Safety &amp; Compliance:</strong> Operating machinery on public roads
              requires a valid license to meet safety and legal standards.
            </li>
            <li>
              <strong className="text-yellow-300">Insurance Coordination:</strong> Collecting your insurance information
              ensures we have the necessary details to coordinate coverage in the unlikely event of an accident or
              equipment damage.
            </li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
};
