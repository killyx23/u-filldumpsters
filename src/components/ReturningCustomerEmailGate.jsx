import React, { useState } from 'react';
import { Mail, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';
import { markVerifiedEmailSession } from '@/utils/checkoutEmailVerification';
import { getAppOrigin } from '@/utils/getAppOrigin';
import { saveVerificationDeadline } from '@/utils/verificationCodeWindow';

export const ReturningCustomerEmailGate = ({
  email: initialEmail,
  pendingToken = null,
  onVerified,
  onCancel,
  variant = 'inline',
}) => {
  const [email, setEmail] = useState(initialEmail || '');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendCode = async (e) => {
    e?.preventDefault();
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-verification-email', {
        body: {
          email: normalizedEmail,
          name: 'Valued Customer',
          pending_customer_id: pendingToken || null,
          site_url: getAppOrigin(),
        },
      });
      if (fnError) throw new Error(await parseEdgeFunctionError(fnError, data));
      if (data?.error) throw new Error(data.error);
      if (pendingToken) {
        saveVerificationDeadline(pendingToken, data?.expiresAt);
      }
      setStep('code');
      toast({ title: 'Code Sent', description: `We sent a verification code to ${normalizedEmail}.` });
    } catch (err) {
      setError(err.message || 'Failed to send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e?.preventDefault();
    const trimmedCode = code.trim();
    if (trimmedCode.length !== 6) {
      setError('Please enter the complete 6-digit verification code');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-email-code', {
        body: {
          email: normalizedEmail,
          code: trimmedCode,
          ...(pendingToken ? { pending_customer_id: pendingToken } : {}),
        },
      });
      if (verifyError) throw new Error(await parseEdgeFunctionError(verifyError, verifyData));
      if (!verifyData?.success) throw new Error(verifyData?.error || 'Invalid verification code');

      markVerifiedEmailSession(normalizedEmail, pendingToken || null);
      toast({ title: 'Email Verified', description: 'You can now confirm your driver and vehicle documents.' });
      onVerified?.({ email: normalizedEmail, customer: verifyData.customer || null });
    } catch (err) {
      setError(err.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const wrapperClass = variant === 'step'
    ? 'space-y-4'
    : 'mb-6 bg-blue-900/30 border border-blue-500/50 p-6 rounded-xl space-y-4';

  return (
    <div className={wrapperClass}>
      {variant !== 'step' && (
      <div>
        <h4 className="text-lg font-semibold text-blue-200">Verify Your Email</h4>
        <p className="text-sm text-blue-100/90 mt-1">
          Please verify your email before we can display or collect any driver or vehicle documents for this rental.
        </p>
      </div>
      )}

      {step === 'email' && (
        <form onSubmit={handleSendCode} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="gate-email" className="text-white">Email Address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-300" />
              <Input
                id="gate-email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                className="pl-10 bg-white/10 border-white/30 text-white"
                required
              />
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex gap-3">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
                Back
              </Button>
            )}
            <Button type="submit" disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-700">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Verification Code'}
            </Button>
          </div>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={handleVerifyCode} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="gate-code" className="text-white">Verification Code</Label>
            <Input
              id="gate-code"
              type="text"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
              className="text-center text-2xl tracking-[0.5em] font-mono bg-white/10 border-white/30 text-white"
              autoFocus
            />
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => { setStep('email'); setCode(''); }} className="flex-1">
              Back
            </Button>
            <Button type="submit" disabled={loading || code.length !== 6} className="flex-1 bg-green-600 hover:bg-green-700">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify & Continue'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};

const ErrorBanner = ({ message }) => (
  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
    <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
    <p className="text-sm text-red-200">{message}</p>
  </div>
);
