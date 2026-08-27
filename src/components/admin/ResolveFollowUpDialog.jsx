import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FOLLOW_UP_REASONS,
  buildFollowUpResolutionPayload,
  getFollowUpReasonLabel,
  reasonClosesFlag,
  reasonRequiresNotes,
} from '@/utils/followUpResolution';

export const ResolveFollowUpDialog = ({
  open,
  onOpenChange,
  booking,
  onResolved,
}) => {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const previous = booking?.follow_up_resolution || null;

  useEffect(() => {
    if (!open) return;
    setReason(previous?.reason && !reasonClosesFlag(previous.reason) ? previous.reason : '');
    setNotes(previous?.notes && !reasonClosesFlag(previous.reason) ? previous.notes : '');
  }, [open, booking?.id, previous?.reason, previous?.notes]);

  const closesFlag = useMemo(() => (reason ? reasonClosesFlag(reason) : true), [reason]);
  const notesRequired = useMemo(() => reasonRequiresNotes(reason), [reason]);
  const canSubmit = Boolean(reason) && (!notesRequired || String(notes || '').trim().length > 0);

  const handleSubmit = async () => {
    if (!booking?.id || !canSubmit) return;

    setSaving(true);
    try {
      const updatedBy = user?.email || user?.id || null;
      const followUpResolution = buildFollowUpResolutionPayload({
        reason,
        notes,
        updatedBy,
        previous,
      });

      const updates = {
        follow_up_resolution: followUpResolution,
      };
      if (followUpResolution.closes_flag) {
        updates.status = 'Completed';
      }

      const { error } = await supabase
        .from('bookings')
        .update(updates)
        .eq('id', booking.id);

      if (error) throw error;

      toast({
        title: followUpResolution.closes_flag
          ? 'Follow-up resolved'
          : 'Follow-up hold saved',
        description: followUpResolution.closes_flag
          ? `Booking #${booking.id} is no longer flagged.`
          : `Booking #${booking.id} stays on Action Items until repaired.`,
      });

      onOpenChange?.(false);
      onResolved?.(updates);
    } catch (err) {
      toast({
        title: 'Could not save follow-up resolution',
        description: err.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-yellow-400 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-yellow-400">
            {previous && !reasonClosesFlag(previous.reason)
              ? 'Update / Close Follow-up'
              : 'Resolve Follow-up'}
          </DialogTitle>
          <DialogDescription>
            Booking #{booking?.id}. Choose why this flag is finished, or keep it open if equipment must be repaired before the next rental.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {previous?.reason && (
            <div className="rounded-md border border-white/10 bg-white/5 p-3 text-sm text-blue-100">
              <p className="font-semibold text-yellow-300 mb-1">Current status</p>
              <p>{getFollowUpReasonLabel(previous.reason)}</p>
              {previous.notes && <p className="mt-1 text-blue-200 italic">“{previous.notes}”</p>}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="follow-up-reason" className="text-blue-100">
              Completion reason <span className="text-red-400">*</span>
            </Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="follow-up-reason" className="w-full">
                <SelectValue placeholder="Select a reason…" />
              </SelectTrigger>
              <SelectContent>
                {FOLLOW_UP_REASONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="follow-up-notes" className="text-blue-100">
              Notes {notesRequired ? <span className="text-red-400">*</span> : <span className="text-gray-400">(optional)</span>}
            </Label>
            <Textarea
              id="follow-up-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={notesRequired ? 'Describe what was completed…' : 'Optional details…'}
              className="min-h-[100px]"
            />
          </div>

          {reason && (
            <div
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                closesFlag
                  ? 'border-green-500/40 bg-green-900/20 text-green-200'
                  : 'border-orange-500/40 bg-orange-900/20 text-orange-200'
              }`}
            >
              {closesFlag ? (
                <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <p>
                {closesFlag
                  ? 'This will mark the rental Completed and clear it from Action Items.'
                  : 'This will keep the rental flagged on Action Items until you mark it repaired/ready.'}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-white/30 text-white"
            onClick={() => onOpenChange?.(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className={closesFlag ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700'}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : closesFlag ? (
              'Finalize & Clear Flag'
            ) : (
              'Save Hold'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
