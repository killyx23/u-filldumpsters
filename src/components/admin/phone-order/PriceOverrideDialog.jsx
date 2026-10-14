import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { SignaturePad } from '@/components/admin/phone-order/SignaturePad';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';

export function UnlockManualDialog({ open, onClose, onUnlocked }) {
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [reason, setReason] = useState('');
  const [initials, setInitials] = useState('');
  const [signature, setSignature] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState('');

  const reset = () => {
    setPassword('');
    setUnlocked(false);
    setReason('');
    setInitials('');
    setSignature('');
    setError('');
    setAcceptedAt('');
  };

  const verify = async () => {
    setBusy(true);
    setError('');
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      setBusy(false);
      setError('Sign in again. This uses the same admin session as the rest of the dashboard.');
      return;
    }
    const { data, error: invokeError } = await supabase.functions.invoke('verify-admin-override', {
      body: { password },
      headers: { Authorization: `Bearer ${token}` },
    });
    setBusy(false);
    if (invokeError || data?.error || !data?.ok) {
      setError(await parseEdgeFunctionError(invokeError, data));
      return;
    }
    setAcceptedAt(new Date().toISOString());
    setUnlocked(true);
    setPassword('');
  };

  const save = () => {
    if (!reason.trim() || initials.trim().length < 2 || !signature) {
      setError('Reason, initials, and a signature are required.');
      return;
    }
    onUnlocked({
      reason: reason.trim(),
      initials: initials.trim().toUpperCase(),
      signature_data: signature,
      password_accepted_at: acceptedAt,
    });
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { reset(); onClose(); } }}>
      <DialogContent className="bg-gray-900 text-white border-yellow-400 max-w-lg">
        <DialogHeader>
          <DialogTitle>Unlock manual changes</DialogTitle>
          <DialogDescription className="text-gray-300">
            This is the same password used to delete a booking. After it is accepted, every field on this call can be changed. Each change is saved to the audit log with your admin account.
          </DialogDescription>
        </DialogHeader>
        {!unlocked ? (
          <div className="space-y-3">
            <Label htmlFor="override-password">Manager password</Label>
            <Input id="override-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-white/10 border-white/30" />
          </div>
        ) : (
          <div className="space-y-3">
            <Label htmlFor="override-reason">Why this order needs a manual change</Label>
            <Textarea id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="bg-white/10 border-white/30" />
            <Label htmlFor="override-initials">Initials</Label>
            <Input id="override-initials" value={initials} onChange={(e) => setInitials(e.target.value)} maxLength={4} className="bg-white/10 border-white/30 w-28" />
            <Label>Signature</Label>
            <SignaturePad onChange={setSignature} />
          </div>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
        <DialogFooter>
          {!unlocked ? (
            <Button onClick={verify} disabled={busy || !password} className="bg-yellow-400 text-black hover:bg-yellow-300">Check password</Button>
          ) : (
            <Button onClick={save} className="bg-yellow-400 text-black hover:bg-yellow-300">Unlock this call</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
