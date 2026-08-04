import React from 'react';
import { Shield } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * Hardware / rental insurance coverage details dialog (shared by booking + reschedule).
 */
export function HardwareProtectionInfoDialog({
  open,
  onOpenChange,
  insurancePrice = 25,
  isDumpLoaderWithDelivery = false,
  customInfoText = null,
}) {
  const price = Number(insurancePrice) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-yellow-500 text-white max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-yellow-400 text-2xl flex items-center">
            <Shield className="mr-2 h-6 w-6" />
            Hardware Protection For Only ${price.toFixed(2)}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <DialogDescription className="text-blue-100 space-y-4">
            {isDumpLoaderWithDelivery ? (
              <p>
                {customInfoText ||
                  'Insurance covers damage to the rental equipment while in your possession during loading. This provides peace of mind if the bin, doors, hinges, or equipment are accidentally damaged while you have it. Insurance covers the first $500 of repair costs.'}
              </p>
            ) : (
              <>
                <p>
                  Just for a small fee. Gain peace of mind for our premium Sure-Trac equipment. Our
                  hardware protection reduces your liability for accidental damage to critical
                  systems.
                </p>

                <div>
                  <h5 className="font-bold text-white text-lg mb-2">How it Works:</h5>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Provides up to a $500 credit toward repair or replacement costs.</li>
                    <li>
                      Significantly reduces your out-of-pocket expenses for accidental hardware
                      damage.
                    </li>
                  </ul>
                </div>

                <div>
                  <h5 className="font-bold text-white text-lg mb-2">What&apos;s Covered:</h5>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Auto-Tarping System</li>
                    <li>Wireless Remote System</li>
                    <li>Hydraulic Lift System</li>
                    <li>Winch &amp; Lighting</li>
                  </ul>
                </div>

                <div className="bg-red-900/20 p-4 rounded border border-red-500/30">
                  <h5 className="font-bold text-red-400 text-lg mb-2">
                    ZERO COVERAGE for Misuse or Negligence:
                  </h5>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Overloading beyond the trailer&apos;s rated capacity</li>
                    <li>Improper Tarping procedures leading to mechanical failure</li>
                    <li>Gross Negligence, reckless operation, or intentional damage</li>
                  </ul>
                </div>

                <div className="bg-yellow-900/20 p-3 rounded border border-yellow-500/30 text-sm">
                  <p>
                    <strong>Note:</strong> This protection strictly covers only the listed hardware
                    stated above. It does not cover tire damage due to negligence or misuse. Also,
                    any wear and tear that is beyond expected normal wear, along with any cosmetic
                    scratches, dings, or dents. Including large dents or improper use causing damage
                    to hinges or the doors, Etc. Coverage applies strictly to the roll-off trailer
                    itself. It does not cover your tow vehicle, personal property, or driveway, Etc.
                  </p>
                </div>
              </>
            )}
          </DialogDescription>
        </ScrollArea>
        <div className="flex justify-end mt-4">
          <Button
            onClick={() => onOpenChange(false)}
            className="bg-yellow-500 hover:bg-yellow-600 text-black"
          >
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
