import React, { useCallback, useState } from 'react';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Lock, Unlock } from 'lucide-react';
import { invokeLockLifecycle } from '@/lib/lockLifecycleInvoke';
import LockOpenCloseTimes from '@/components/admin/LockOpenCloseTimes';

const PENDING_ACTION = {
  remote_unlock: {
    title: 'Remote unlock padlock?',
    description:
      'This sends a Bluetooth unlock job through the Wi-Fi bridge. The padlock will open physically. ' +
      'This does not use a booking PIN and will not mark any rental as Rented or Returned.',
    confirmLabel: 'Unlock padlock',
    confirmClass: 'bg-orange-600 hover:bg-orange-700 text-white',
  },
  remote_lock: {
    title: 'Remote lock padlock?',
    description:
      'This sends a Bluetooth lock job through the Wi-Fi bridge. The padlock will close physically. ' +
      'This does not use a booking PIN and will not mark any rental as Returned.',
    confirmLabel: 'Lock padlock',
    confirmClass: 'bg-slate-600 hover:bg-slate-700 text-white',
  },
};

export default function RemoteBridgeControls({
  bridgeOnline,
  onSuccess,
  compact = false,
  lastOpenedAt = null,
  lastClosedAt = null,
}) {
  const [busy, setBusy] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);

  const runRemote = useCallback(
    async (action) => {
      setBusy(action);
      setPendingAction(null);
      try {
        const data = await invokeLockLifecycle(action);
        toast({
          title: action === 'remote_unlock' ? 'Remote unlock sent' : 'Remote lock sent',
          description: `Job ${data.jobId} — ${data.jobState || 'completed'}${
            data.jobState === 'pending' ? ' (bridge still finishing)' : ''
          }.`,
        });
        onSuccess?.(data);
      } catch (err) {
        toast({
          title: action === 'remote_unlock' ? 'Remote unlock failed' : 'Remote lock failed',
          description: err.message || 'Request failed',
          variant: 'destructive',
        });
      } finally {
        setBusy(null);
      }
    },
    [onSuccess],
  );

  const bridgeOffline = bridgeOnline === false;
  const disabled = !!busy || bridgeOffline;

  const buttons = (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        className="bg-orange-600 hover:bg-orange-700"
        disabled={disabled}
        onClick={() => setPendingAction('remote_unlock')}
      >
        {busy === 'remote_unlock' ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Unlock className="h-4 w-4 mr-2" />
        )}
        Remote Unlock
      </Button>
      <Button
        type="button"
        variant="outline"
        className="border-slate-500/50 text-slate-200 hover:bg-slate-800"
        disabled={disabled}
        onClick={() => setPendingAction('remote_lock')}
      >
        {busy === 'remote_lock' ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Lock className="h-4 w-4 mr-2" />
        )}
        Remote Lock
      </Button>
    </div>
  );

  return (
    <>
      <div className={compact ? 'rounded-lg border border-white/10 bg-black/20 p-3 space-y-2' : 'rounded-lg border border-white/10 bg-black/20 p-4 space-y-3'}>
        {!compact && (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm font-medium text-slate-200">Remote bridge controls</p>
            <LockOpenCloseTimes
              lastOpenedAt={lastOpenedAt}
              lastClosedAt={lastClosedAt}
              align="right"
            />
          </div>
        )}
        {compact && (
          <LockOpenCloseTimes
            lastOpenedAt={lastOpenedAt}
            lastClosedAt={lastClosedAt}
            align="right"
          />
        )}
        {!compact && (
          <p className="text-xs text-slate-500">
            Opens or closes the padlock via the Wi-Fi bridge. Does not use a booking PIN — will not
            mark a rental Rented or Returned.
          </p>
        )}
        {bridgeOffline && (
          <p className={`text-xs text-amber-300/90 ${compact ? 'text-right' : ''}`}>
            Bridge is offline. Remote jobs cannot complete until the bridge reconnects.
          </p>
        )}
        {buttons}
      </div>

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent className="bg-gray-900 border-gray-700 text-white">
          {pendingAction && PENDING_ACTION[pendingAction] && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{PENDING_ACTION[pendingAction].title}</AlertDialogTitle>
                <AlertDialogDescription className="text-gray-400">
                  {PENDING_ACTION[pendingAction].description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-gray-700 text-gray-300 hover:bg-gray-800">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  className={PENDING_ACTION[pendingAction].confirmClass}
                  onClick={() => runRemote(pendingAction)}
                >
                  {PENDING_ACTION[pendingAction].confirmLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
