import React from 'react';
import { Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export const PickupLocationInfoDialog = ({ open, onOpenChange }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-yellow-500/50 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-yellow-400 text-xl sm:text-2xl flex items-center gap-2">
            <Info className="h-6 w-6 shrink-0" />
            Why We Use On-Demand Pickup Locations
          </DialogTitle>
          <DialogDescription className="sr-only">
            Information about our on-demand pickup network and how it works.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pr-1 text-sm text-gray-300 leading-relaxed">
          <p>
            To keep our rental rates as low as possible, we utilize a decentralized, secure pickup
            network instead of high-overhead storefronts. By eliminating expensive commercial real
            estate costs, we pass 100% of those savings directly to you.
          </p>

          <ul className="space-y-3 list-none">
            <li>
              <span aria-hidden className="mr-1">📍</span>
              <strong className="text-white">Convenience:</strong> We route your order to the
              closest available address based on your location.
            </li>
            <li>
              <span aria-hidden className="mr-1">🔐</span>
              <strong className="text-white">Security:</strong> Your exact pickup address and secure
              gate/lock codes are dispatched via email/text or back here to the customer portal
              exactly 12 hours before your booking.
            </li>
            <li>
              <span aria-hidden className="mr-1">📏</span>
              <strong className="text-white">Accuracy:</strong> Approximate mileage and travel times
              are provided instantly at checkout so you can plan your trip.
            </li>
          </ul>

          <section>
            <h3 className="text-lg font-semibold text-yellow-400 mb-3">
              Our Low-Overhead Promise: How We Save You Money
            </h3>
            <p className="mb-3">
              Traditional rental companies pass the massive costs of commercial showrooms, staff, and
              storage yards onto the customer. We do things differently.
            </p>
            <p className="mb-3">
              We operate a streamlined, residential-based logistics network. This smart-sharing model
              allows us to position equipment closer to where you live while completely eliminating
              brick-and-mortar overhead.
            </p>
            <p>
              To protect our equipment and ensure a seamless contactless experience, our system
              automatically releases the exact address and your personal access code 12 hours prior to
              your scheduled pickup time.
            </p>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-yellow-400 mb-4">
              How Our Pickup System Works
            </h3>
            <div className="space-y-4">
              <div>
                <p className="font-semibold text-white mb-1">
                  <span aria-hidden className="mr-1">🚛</span>
                  Where do I pick up my equipment?
                </p>
                <p>
                  We use a network of secure, private fulfillment locations to keep our overhead low
                  and our prices unmatched. You can see an estimated mileage and radius map right here
                  in the customer portal at any time.
                </p>
              </div>
              <div>
                <p className="font-semibold text-white mb-1">
                  <span aria-hidden className="mr-1">🕒</span>
                  When do I get the exact address?
                </p>
                <p>
                  For security and scheduling efficiency, your specific pickup location address and
                  unique lockbox codes are automatically generated and sent to you 12 hours before your
                  reservation begins.
                </p>
              </div>
              <div>
                <p className="font-semibold text-white mb-1">
                  <span aria-hidden className="mr-1">🔄</span>
                  How do returns work?
                </p>
                <p>
                  Simply drop the equipment back off at the exact same location where you picked it up,
                  park it securely, and lock it back up. Please make sure it is securely locked, as this
                  will let us know that you have delivered it back to us, and the time that you did so, so
                  you do not incur any additional late fees.
                </p>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};
