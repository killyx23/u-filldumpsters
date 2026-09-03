import React, { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { COUNTDOWN_MS } from '@/utils/checkoutIdleGuard';

function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Self-ticking display so the 5:00 → 4:59 → … clock keeps moving even if the
 * parent re-renders. Parent still owns the real teardown timeout.
 */
export const StillHereDialog = ({
  open,
  remainingMs = COUNTDOWN_MS,
  onNeedMoreTime,
}) => {
  const [displayMs, setDisplayMs] = useState(remainingMs);

  useEffect(() => {
    if (!open) {
      setDisplayMs(remainingMs > 0 ? remainingMs : COUNTDOWN_MS);
      return undefined;
    }

    const startMs = remainingMs > 0 ? remainingMs : COUNTDOWN_MS;
    const endsAt = Date.now() + startMs;
    setDisplayMs(startMs);

    const id = window.setInterval(() => {
      setDisplayMs(Math.max(0, endsAt - Date.now()));
    }, 200);

    return () => window.clearInterval(id);
    // Only restart the local clock when the dialog opens (or re-opens).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: open edge
  }, [open]);

  const secondsLeft = Math.max(0, Math.ceil(displayMs / 1000));

  return (
    <AlertDialog open={open} onOpenChange={() => {}}>
      <AlertDialogContent className="bg-gray-900 border-gray-700 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still here?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-gray-400 space-y-3">
              <p>
                Your unfinished order will be cancelled if we do not hear from you. Equipment and
                reserved dates will be released so others can book them.
              </p>
              <p
                className="text-yellow-300 font-semibold text-2xl tabular-nums tracking-wide"
                aria-live="polite"
                aria-atomic="true"
              >
                Cancelling in {formatCountdown(displayMs)}
              </p>
              <p className="text-xs text-gray-500">
                {secondsLeft} second{secondsLeft === 1 ? '' : 's'} remaining
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={onNeedMoreTime}
            className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold"
          >
            Yes — I need more time
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
