import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, Shield, Smartphone, Copy, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/components/ui/use-toast';
import {
  challengeAndVerifyTotp,
  decideAdminMfaView,
  getVerifiedTotpFactors,
  toQrImageSrc,
  unenrollUnverifiedTotpFactors,
} from '@/lib/adminMfa';

const otpSlotClass =
  'h-11 w-11 border-white/30 bg-white/10 text-white text-lg first:border-l';

function AuthenticatorCodeInput({ value, onChange, disabled }) {
  return (
    <InputOTP
      maxLength={6}
      value={value}
      onChange={onChange}
      disabled={disabled}
      containerClassName="justify-center"
    >
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <InputOTPSlot key={index} index={index} className={otpSlotClass} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

function EnrollMfa({ onEnrolled, onAlreadyEnrolled }) {
  const { toast } = useToast();
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const startEnrollment = useCallback(async () => {
    setStarting(true);
    setError('');
    try {
      const existing = await getVerifiedTotpFactors(supabase);
      if (existing.length > 0) {
        onAlreadyEnrolled();
        return null;
      }
      await unenrollUnverifiedTotpFactors(supabase);
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'U-Fill Dumpsters',
        friendlyName: 'Authenticator',
      });
      if (enrollError) throw enrollError;
      return data;
    } catch (err) {
      console.error('[AdminMfa] Enroll failed:', err);
      setError(err.message || 'Could not start authenticator setup.');
      setStarting(false);
      return null;
    }
  }, [onAlreadyEnrolled]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const data = await startEnrollment();
      if (!data || cancelled) return;
      setFactorId(data.id);
      setQr(toQrImageSrc(data.totp.qr_code));
      setSecret(data.totp.secret);
      setStarting(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [startEnrollment]);

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast({ title: 'Copied', description: 'Secret key copied. Paste it into your authenticator app.' });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: 'Select and copy the secret key manually.',
      });
    }
  };

  const handleEnable = async (e) => {
    e.preventDefault();
    if (code.length !== 6 || !factorId) return;
    setSubmitting(true);
    setError('');
    try {
      const { error: verifyError } = await challengeAndVerifyTotp(supabase, factorId, code);
      if (verifyError) throw verifyError;
      toast({
        title: 'Authenticator enabled',
        description: 'Your admin account is now protected with MFA.',
      });
      await onEnrolled();
    } catch (err) {
      setError(err.message || 'That code was not valid. Try the latest code from your app.');
      setCode('');
    } finally {
      setSubmitting(false);
    }
  };

  if (starting) {
    return (
      <div className="flex flex-col items-center py-8">
        <Loader2 className="h-10 w-10 animate-spin text-yellow-400 mb-3" />
        <p className="text-blue-200">Preparing authenticator setup…</p>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleEnable}>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-white">Set up an authenticator app</h2>
        <p className="text-sm text-blue-200">
          Scan the QR code with Google Authenticator, Microsoft Authenticator, Authy, 1Password,
          or any app that supports TOTP.
        </p>
      </div>

      {qr && (
        <div className="flex justify-center">
          <div className="bg-white p-3 rounded-xl">
            <img src={qr} alt="Authenticator QR code" className="h-48 w-48" />
          </div>
        </div>
      )}

      {secret && (
        <div className="space-y-2">
          <Label className="text-white">Can&apos;t scan? Enter this key instead</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm text-yellow-200 break-all font-mono bg-black/30 px-3 py-2 rounded-md">
              {secret}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copySecret}
              className="shrink-0 border-white/30 text-white hover:bg-white/10"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-white">Enter the 6-digit code from your app</Label>
        <AuthenticatorCodeInput value={code} onChange={setCode} disabled={submitting} />
      </div>

      {error && <p className="text-sm text-red-300 text-center">{error}</p>}

      <Button
        type="submit"
        className="w-full text-lg bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
        disabled={submitting || code.length !== 6}
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Verifying…
          </>
        ) : (
          <>
            <Smartphone className="mr-2 h-5 w-5" />
            Enable authenticator
          </>
        )}
      </Button>
    </form>
  );
}

function ChallengeMfa({ onVerified }) {
  const { toast } = useToast();
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loadingFactor, setLoadingFactor] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const verified = await getVerifiedTotpFactors(supabase);
        if (cancelled) return;
        const totp = verified[0];
        if (!totp) {
          setError('No authenticator is enrolled on this account.');
        } else {
          setFactorId(totp.id);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load authenticator.');
      } finally {
        if (!cancelled) setLoadingFactor(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (code.length !== 6 || !factorId) return;
    setSubmitting(true);
    setError('');
    try {
      const { error: verifyError } = await challengeAndVerifyTotp(supabase, factorId, code);
      if (verifyError) throw verifyError;
      toast({
        title: 'Verified',
        description: 'Authenticator code accepted.',
      });
      await onVerified();
    } catch (err) {
      const message = err.message || 'That code was not valid. Try the latest code from your app.';
      setError(message);
      setCode('');
      if (/session|jwt|expired|not found/i.test(message)) {
        toast({
          variant: 'destructive',
          title: 'Session expired',
          description: 'Sign in again, then enter a fresh authenticator code.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingFactor) {
    return (
      <div className="flex flex-col items-center py-8">
        <Loader2 className="h-10 w-10 animate-spin text-yellow-400 mb-3" />
        <p className="text-blue-200">Checking authenticator…</p>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-white">Enter your authenticator code</h2>
        <p className="text-sm text-blue-200">
          Open Google Authenticator, Microsoft Authenticator, or the app you used when setting up MFA.
        </p>
      </div>

      <AuthenticatorCodeInput value={code} onChange={setCode} disabled={submitting} />

      {error && <p className="text-sm text-red-300 text-center">{error}</p>}

      <Button
        type="submit"
        className="w-full text-lg bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
        disabled={submitting || code.length !== 6 || !factorId}
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Verifying…
          </>
        ) : (
          <>
            <Shield className="mr-2 h-5 w-5" />
            Verify and continue
          </>
        )}
      </Button>
    </form>
  );
}

export const AdminMfaPage = () => {
  const {
    user,
    isAdmin,
    loading: authLoading,
    currentAal,
    needsMfaEnrollment,
    needsMfaChallenge,
    mfaReady,
    refreshMfa,
    signOut,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [forceChallenge, setForceChallenge] = useState(false);
  const from = location.state?.from?.pathname || '/admin/dashboard';
  const switchToChallenge = useCallback(() => setForceChallenge(true), []);

  const continueToAdmin = async () => {
    await refreshMfa();
    navigate(from, { replace: true });
  };

  if (authLoading || (user && !mfaReady)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)]">
        <Loader2 className="h-16 w-16 animate-spin text-yellow-400 mb-4" />
        <p className="text-white text-lg">Checking authenticator…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin-login" state={{ from: location.state?.from || location }} replace />;
  }

  if (!isAdmin) {
    return (
      <Navigate
        to="/admin-login"
        state={{ from: location, error: 'unauthorized', userEmail: user.email }}
        replace
      />
    );
  }

  const mfaView = forceChallenge
    ? 'challenge'
    : decideAdminMfaView({
        currentAal,
        verifiedTotpCount: needsMfaEnrollment ? 0 : (needsMfaChallenge || currentAal === 'aal2' ? 1 : 0),
      });

  if (mfaView === 'dashboard') {
    return <Navigate to={from} replace />;
  }

  const showEnroll = mfaView === 'enroll';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex items-center justify-center min-h-[calc(100vh-200px)] px-4 py-8"
    >
      <div className="w-full max-w-md p-8 space-y-6 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="bg-yellow-500 p-3 rounded-full">
              <Shield className="h-8 w-8 text-black" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-yellow-400">Admin MFA</h1>
          <p className="text-blue-200">
            {showEnroll
              ? 'Authenticator setup is required before accessing the dashboard.'
              : `Welcome, ${user.email}`}
          </p>
        </div>

        {showEnroll ? (
          <EnrollMfa
            onEnrolled={continueToAdmin}
            onAlreadyEnrolled={switchToChallenge}
          />
        ) : (
          <ChallengeMfa onVerified={continueToAdmin} />
        )}

        <Button
          type="button"
          variant="ghost"
          className="w-full text-blue-200 hover:text-white hover:bg-white/10"
          onClick={() => signOut()}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </motion.div>
  );
};

export default AdminMfaPage;
