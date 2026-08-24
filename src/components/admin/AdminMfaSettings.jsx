import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, ShieldCheck, Smartphone, Copy } from 'lucide-react';
import {
  challengeAndVerifyTotp,
  getVerifiedTotpFactors,
  toQrImageSrc,
  unenrollUnverifiedTotpFactors,
} from '@/lib/adminMfa';

const otpSlotClass =
  'h-10 w-10 border-gray-600 bg-gray-900 text-white first:border-l';

export const AdminMfaSettings = () => {
  const { refreshMfa } = useAuth();
  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState([]);
  const [replacing, setReplacing] = useState(false);
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      setFactors(await getVerifiedTotpFactors(supabase));
    } catch (err) {
      console.error('[AdminMfaSettings] listFactors:', err);
      toast({
        title: 'Could not load MFA status',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  const startReplace = async () => {
    setError('');
    setCode('');
    setReplacing(true);
    try {
      await unenrollUnverifiedTotpFactors(supabase);
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'U-Fill Dumpsters',
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrollError) throw enrollError;
      setFactorId(data.id);
      setQr(toQrImageSrc(data.totp.qr_code));
      setSecret(data.totp.secret);
    } catch (err) {
      setReplacing(false);
      toast({
        title: 'Could not start replacement',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  const cancelReplace = async () => {
    if (factorId) {
      try {
        await supabase.auth.mfa.unenroll({ factorId });
      } catch {
        // leftover unverified factor is cleaned on next enroll
      }
    }
    setReplacing(false);
    setFactorId('');
    setQr('');
    setSecret('');
    setCode('');
    setError('');
  };

  const confirmReplace = async (e) => {
    e.preventDefault();
    if (code.length !== 6 || !factorId) return;
    setSubmitting(true);
    setError('');
    try {
      const { error: verifyError } = await challengeAndVerifyTotp(supabase, factorId, code);
      if (verifyError) throw verifyError;

      const previous = factors.filter((factor) => factor.id !== factorId);
      for (const old of previous) {
        const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: old.id });
        if (unenrollError) {
          console.error('[AdminMfaSettings] unenroll old factor:', unenrollError);
        }
      }

      toast({
        title: 'Authenticator replaced',
        description: 'Use the new device for admin sign-in from now on.',
      });
      setReplacing(false);
      setFactorId('');
      setQr('');
      setSecret('');
      setCode('');
      await refreshMfa();
      await loadFactors();
    } catch (err) {
      setError(err.message || 'That code was not valid. Try the latest code from your app.');
      setCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast({ title: 'Copied', description: 'Secret key copied to clipboard.' });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Select and copy the secret key manually.',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-6 w-6 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
      <h2 className="text-xl font-bold text-white mb-2 flex items-center">
        <ShieldCheck className="mr-2 h-5 w-5 text-yellow-400" />
        Authenticator app (MFA)
      </h2>
      <p className="text-sm text-gray-400 mb-4">
        Admin access requires a TOTP app such as Google Authenticator or Microsoft Authenticator.
        {factors.length > 0
          ? ' A device is enrolled on this account.'
          : ' No authenticator is enrolled yet — you will be asked to set one up at sign-in.'}
      </p>

      {factors.length > 0 && (
        <ul className="mb-4 space-y-2">
          {factors.map((factor) => (
            <li
              key={factor.id}
              className="text-sm text-gray-200 bg-gray-900 border border-gray-700 rounded-md px-3 py-2"
            >
              {factor.friendly_name || 'Authenticator'} — enrolled
            </li>
          ))}
        </ul>
      )}

      {!replacing && (
        <Button
          type="button"
          onClick={startReplace}
          className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
        >
          <Smartphone className="h-4 w-4 mr-2" />
          {factors.length > 0 ? 'Replace authenticator' : 'Enroll authenticator'}
        </Button>
      )}

      {replacing && (
        <form onSubmit={confirmReplace} className="space-y-4 max-w-xl">
          <p className="text-sm text-gray-300">
            Scan the new QR code and verify it before the old device is removed. If you lose access
            to your app, recover MFA from the Supabase Dashboard (Auth user → MFA factors).
          </p>
          {qr && (
            <div className="bg-white p-3 rounded-xl w-fit">
              <img src={qr} alt="Replacement authenticator QR code" className="h-40 w-40" />
            </div>
          )}
          {secret && (
            <div>
              <Label className="text-gray-300">Secret key</Label>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 text-sm text-yellow-200 break-all font-mono bg-gray-900 px-3 py-2 rounded-md">
                  {secret}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copySecret}
                  className="shrink-0 border-gray-600"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <div>
            <Label className="text-gray-300">6-digit code from the new app</Label>
            <div className="mt-2">
              <InputOTP maxLength={6} value={code} onChange={setCode} disabled={submitting}>
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot key={index} index={index} className={otpSlotClass} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={submitting || code.length !== 6}
              className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Verify and replace
            </Button>
            <Button type="button" variant="outline" onClick={cancelReplace} className="border-gray-600">
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
