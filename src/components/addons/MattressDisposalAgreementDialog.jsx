import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export const MATTRESS_DISPOSAL_DECLINE_MESSAGE = 'Sorry, we cannot offer you this service.';

export function isMattressDisposalAddon(item) {
  const id = Number(item?.id ?? item?.dbId ?? item?.equipment_id);
  if (id === 4) return true;
  const name = String(item?.name || item?.label || '').toLowerCase();
  return name.includes('mattress');
}

function DisposalAgreementDialog({ open, onOpenChange, onAgree, title, declinedTitle, paragraphs }) {
  const [declined, setDeclined] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const agreedRef = useRef(false);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDeclined(false);
      agreedRef.current = false;
    }
  }

  const requestClose = (nextOpen) => {
    if (nextOpen) return;
    if (agreedRef.current) {
      onOpenChange(false);
      return;
    }
    if (!declined) {
      setDeclined(true);
      return;
    }
    onOpenChange(false);
  };

  const agree = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (agreedRef.current) return;
    agreedRef.current = true;
    onAgree();
    // Close after this click finishes so the press cannot land on the
    // plus or minus control underneath and undo the add.
    window.setTimeout(() => onOpenChange(false), 250);
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        className="bg-gray-900 border-yellow-400 text-white z-[9999]"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl text-yellow-400">
            {declined ? declinedTitle : title}
          </DialogTitle>
        </DialogHeader>
        {declined ? (
          <p className="text-base text-white">{MATTRESS_DISPOSAL_DECLINE_MESSAGE}</p>
        ) : (
          <div className="space-y-3 text-sm leading-relaxed text-blue-100">
            {paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-end">
          {declined ? (
            <Button
              type="button"
              onClick={() => window.setTimeout(() => onOpenChange(false), 250)}
              className="bg-yellow-400 text-black hover:bg-yellow-300"
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeclined(true)}
                className="border-white/30 text-white hover:bg-white/10"
              >
                I do not agree
              </Button>
              <Button
                type="button"
                onClick={agree}
                className="bg-yellow-400 text-black hover:bg-yellow-300"
              >
                I agree
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MATTRESS_PARAGRAPHS = [
  'Mattresses and box springs cannot be placed in the dump trailer when this service is purchased.',
  'The customer must bring the mattress to the curbside. It will not be collected from inside the home.',
  'It is collected only when it is at the curbside and ready for pickup. It is taken separately because it requires separate sorting at the landfill.',
];

const APPLIANCE_PARAGRAPHS = [
  'Confirm that this appliance contains no refrigerant, including Freon, and that it is an item we can accept.',
  'Appliances without refrigerant may be placed in the dump trailer. Appliances that contain refrigerant, we cannot accept.',
];

export function MattressDisposalAgreementDialog(props) {
  return (
    <DisposalAgreementDialog
      {...props}
      title="Mattress disposal agreement"
      declinedTitle="Mattress disposal"
      paragraphs={MATTRESS_PARAGRAPHS}
    />
  );
}

export function isApplianceDisposalAddon(item) {
  const id = Number(item?.id ?? item?.dbId ?? item?.equipment_id);
  if (id === 6) return true;
  const name = String(item?.name || item?.label || '').toLowerCase();
  return name.includes('appliance');
}

export function ApplianceDisposalAgreementDialog(props) {
  return (
    <DisposalAgreementDialog
      {...props}
      title="Appliance disposal agreement"
      declinedTitle="Appliance disposal"
      paragraphs={APPLIANCE_PARAGRAPHS}
    />
  );
}
