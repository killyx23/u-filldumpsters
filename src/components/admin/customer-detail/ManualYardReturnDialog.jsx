import React, { useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Camera, CheckCircle } from 'lucide-react';
import { getPickupWindowTimes } from '@/utils/bookingPickupWindow';

const BUCKET = 'customer-uploads';

/**
 * Yard staff mark a trailer returned when the lock is parked out of Bluetooth
 * range. A photo or a gate scan is required so the return is not a bare click.
 */
export function ManualYardReturnDialog({ booking, onDone, disabled }) {
  const [open, setOpen] = useState(false);
  const [gateScan, setGateScan] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = Boolean(photo || gateScan.trim());

  const close = () => {
    if (busy) return;
    setOpen(false);
    setGateScan('');
    setPhoto(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast({ title: 'Sign in required', description: 'You must be signed in to mark a return.', variant: 'destructive' });
        return;
      }

      let photoPath = null;
      if (photo) {
        const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'yard-return.jpg';
        photoPath = `${user.id}/yard-returns/${booking.id}-${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(photoPath, photo);
        if (uploadError) {
          toast({ title: 'Photo upload failed', description: uploadError.message, variant: 'destructive' });
          return;
        }
      }

      const at = new Date().toISOString();
      const addons = {
        ...(booking.addons || {}),
        manualReturn: {
          at,
          photoPath,
          gateScan: gateScan.trim() || null,
          reason: 'lock_out_of_range',
        },
      };
      const returnBy = getPickupWindowTimes(booking).returnBy;
      const windowStartMs = returnBy ? returnBy.getTime() - 2 * 60 * 60 * 1000 : null;
      const { data: lockLog } = await supabase
        .from('rental_tracking_logs')
        .select('event_timestamp')
        .eq('order_id', booking.id)
        .eq('event_type', 'lock')
        .order('event_timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();
      const lockMs = lockLog?.event_timestamp ? new Date(lockLog.event_timestamp).getTime() : NaN;
      const returnLockAt = Number.isFinite(lockMs) && windowStartMs !== null && lockMs >= windowStartMs
        ? lockLog.event_timestamp
        : null;
      const { data, error } = await supabase
        .from('bookings')
        .update({
          status: 'pending_checklist',
          returned_at: at,
          return_lock_at: returnLockAt,
          addons,
        })
        .eq('id', booking.id)
        .is('returned_at', null)
        .select('id, status, returned_at')
        .maybeSingle();

      if (error || !data) {
        toast({
          title: 'Could not mark returned',
          description: error?.message || 'The booking was already returned, or the update was blocked.',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'Trailer marked returned', description: `Order ${booking.id} is waiting on the return checklist.` });
      setOpen(false);
      setGateScan('');
      setPhoto(null);
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
        <CheckCircle className="mr-2 h-4 w-4" /> Mark as Returned
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="bg-gray-900 border-white/20 text-white">
          <DialogHeader>
            <DialogTitle>Mark trailer returned</DialogTitle>
            <DialogDescription className="text-blue-100">
              Use this when the trailer is in the yard but the lock is too far for Bluetooth.
              Add a photo of the trailer or the gate scan. One of the two is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`yard-photo-${booking.id}`} className="text-white">Photo</Label>
              <Input
                id={`yard-photo-${booking.id}`}
                type="file"
                accept="image/*"
                capture="environment"
                className="bg-black/30 text-white"
                onChange={(event) => setPhoto(event.target.files?.[0] || null)}
              />
              {photo && (
                <p className="text-xs text-blue-100 flex items-center gap-1">
                  <Camera className="h-3 w-3" /> {photo.name}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`gate-scan-${booking.id}`} className="text-white">Gate scan</Label>
              <Input
                id={`gate-scan-${booking.id}`}
                value={gateScan}
                onChange={(event) => setGateScan(event.target.value)}
                placeholder="Scan or type the gate code"
                className="bg-black/30 text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={!canSubmit || busy}>
              {busy ? 'Saving…' : 'Mark returned'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
