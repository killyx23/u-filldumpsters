
import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, CheckCircle2, XCircle, KeyRound, ShieldCheck, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from '@/components/ui/use-toast';

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlCode = searchParams.get('code');
  
  const [status, setStatus] = useState(urlCode ? 'verifying' : 'idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatedPin, setGeneratedPin] = useState(null);

  useEffect(() => {
    if (urlCode) {
      setManualCode(urlCode);
      handleVerification(urlCode);
    }
  }, [urlCode]);

  const handleVerification = async (codeToVerify) => {
    if (!codeToVerify || codeToVerify.trim() === '') {
      setErrorMessage('Please enter a valid verification code.');
      setStatus('error');
      return;
    }

    setIsProcessing(true);
    setStatus('verifying');
    setErrorMessage('');

    try {
      console.log('[VerifyEmailPage] Starting verification for code:', codeToVerify);

      // Step 1: Verify email code
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-email-code', {
        body: { code: codeToVerify.trim() }
      });

      if (verifyError) {
        const errData = await verifyError.context?.json().catch(() => null);
        throw new Error(errData?.error || verifyError.message || 'Failed to verify email');
      }
      
      if (!verifyData?.success) {
        throw new Error(verifyData?.error || 'Invalid or expired verification code');
      }

      console.log('[VerifyEmailPage] ✓ Email verified, booking_id:', verifyData.booking_id);

      // Step 2: Generate PIN if we have a booking_id
      if (verifyData.booking_id) {
        console.log('[VerifyEmailPage] Generating PIN for booking:', verifyData.booking_id);
        
        const { data: pinData, error: pinError } = await supabase.functions.invoke('generate-pin', {
          body: { booking_id: verifyData.booking_id }
        });

        if (pinError) {
          const errData = await pinError.context?.json().catch(() => null);
          console.error('[VerifyEmailPage] PIN generation error:', errData || pinError);
          // Don't fail completely - email is verified, just show warning
          toast({
            title: "Email Verified",
            description: "Your email was verified, but PIN generation failed. Please contact support.",
            variant: "default"
          });
        } else if (pinData?.success) {
          console.log('[VerifyEmailPage] ✓ PIN generated:', pinData.pin);
          setGeneratedPin(pinData.pin);
        }
      }

      setStatus('success');

      // Redirect to confirmation page after 3 seconds
      setTimeout(() => {
        toast({
          title: "Success!",
          description: "Your email has been verified and your booking is confirmed.",
        });
        navigate('/confirmation');
      }, 3000);

    } catch (err) {
      console.error("[VerifyEmailPage] Verification error:", err);
      setStatus('error');
      setErrorMessage(
        err.message || 
        'We could not verify your email at this time. Please check your code and try again.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const onManualSubmit = (e) => {
    e.preventDefault();
    handleVerification(manualCode);
  };

  return (
    <>
      <Helmet>
        <title>Verify Email - U-Fill Dumpsters</title>
        <meta name="description" content="Verify your email address to complete your booking with U-Fill Dumpsters." />
      </Helmet>
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="bg-slate-900/80 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/10 text-center relative overflow-hidden">
            
            {/* Background Glow */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/20 rounded-full blur-3xl"></div>
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-yellow-500/10 rounded-full blur-3xl"></div>

            <div className="relative z-10">
              <AnimatePresence mode="wait">
                {status === 'verifying' && (
                  <motion.div 
                    key="verifying"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="py-8"
                  >
                    <div className="relative w-20 h-20 mx-auto mb-6">
                      <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-yellow-400 rounded-full border-t-transparent animate-spin"></div>
                      <ShieldCheck className="absolute inset-0 m-auto h-8 w-8 text-yellow-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Verifying Email</h1>
                    <p className="text-gray-300 mb-4">Please wait while we verify your email address...</p>
                    <div className="flex items-center justify-center gap-2 text-sm text-blue-300">
                      <Lock className="h-4 w-4 animate-pulse" />
                      <span>Generating your secure access PIN</span>
                    </div>
                  </motion.div>
                )}

                {status === 'success' && (
                  <motion.div 
                    key="success"
                    initial={{ opacity: 0, y: 10 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    className="py-6"
                  >
                    <div className="mx-auto w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mb-6 border border-green-500/30">
                      <CheckCircle2 className="h-10 w-10 text-green-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-3">Email Verified!</h1>
                    <p className="text-gray-300 mb-6 leading-relaxed">
                      Your email has been successfully verified and your booking is confirmed.
                    </p>
                    
                    {generatedPin && (
                      <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 rounded-xl p-6 mb-6">
                        <div className="flex items-center justify-center gap-2 text-yellow-400 mb-3">
                          <Lock className="h-5 w-5" />
                          <span className="font-semibold">Your Access PIN</span>
                        </div>
                        <div className="text-5xl font-black text-white tracking-wider mb-2">
                          {generatedPin}
                        </div>
                        <p className="text-sm text-gray-400">
                          Use this PIN to access your rental equipment
                        </p>
                      </div>
                    )}

                    <p className="text-blue-300 text-sm mb-4">
                      Redirecting you to your booking confirmation...
                    </p>
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-blue-400" />
                  </motion.div>
                )}

                {(status === 'idle' || status === 'error') && (
                  <motion.div 
                    key="input"
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    className="py-4"
                  >
                    <div className="mx-auto w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mb-6 border border-blue-500/30">
                      <KeyRound className="h-8 w-8 text-blue-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-2">Enter Verification Code</h1>
                    <p className="text-gray-400 text-sm mb-6">
                      Please enter the 6-digit code sent to your email address.
                    </p>

                    {status === 'error' && errorMessage && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-6 p-4 bg-red-900/40 rounded-xl border border-red-500/50 flex items-start text-left"
                      >
                        <XCircle className="h-5 w-5 text-red-400 mt-0.5 mr-3 flex-shrink-0" />
                        <div>
                          <p className="text-red-200 text-sm font-semibold mb-1">Verification Failed</p>
                          <p className="text-red-300 text-sm">{errorMessage}</p>
                        </div>
                      </motion.div>
                    )}

                    <form onSubmit={onManualSubmit} className="space-y-6">
                      <div>
                        <Input
                          type="text"
                          placeholder="000000"
                          value={manualCode}
                          onChange={(e) => setManualCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                          className="text-center text-2xl tracking-widest font-mono py-6 bg-black/40 border-white/20 text-white placeholder:text-gray-600 focus:border-blue-500 focus:ring-blue-500/20 transition-all"
                          required
                          disabled={isProcessing}
                          maxLength={6}
                        />
                      </div>
                      <Button 
                        type="submit" 
                        disabled={isProcessing || manualCode.length < 6}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white py-6 text-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Verifying...
                          </>
                        ) : (
                          'Verify Code'
                        )}
                      </Button>
                    </form>
                    
                    <div className="mt-8 pt-6 border-t border-white/10 text-sm text-gray-400">
                      <p>Didn't receive the email? Check your spam folder or contact support.</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default VerifyEmailPage;
