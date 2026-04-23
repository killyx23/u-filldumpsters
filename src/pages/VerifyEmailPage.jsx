import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, CheckCircle2, XCircle, ArrowRight, ShieldCheck, Mail, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const urlCode = searchParams.get('code');
  
  // States: 'idle', 'verifying', 'success', 'error'
  // If a code is in the URL, start verifying immediately. Otherwise wait for manual input.
  const [status, setStatus] = useState(urlCode ? 'verifying' : 'idle'); 
  const [errorMessage, setErrorMessage] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Check if the code is present in the URL on mount and auto-verify
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
      const { data, error } = await supabase.functions.invoke('verify-email-code', {
        body: { code: codeToVerify.trim() }
      });

      if (error) {
         // Try to parse error response if it's from the edge function
         const errData = await error.context?.json().catch(() => null);
         throw new Error(errData?.error || error.message || 'Failed to communicate with verification server.');
      }
      
      if (!data?.success) {
        throw new Error(data?.error || 'The verification code was invalid or has expired.');
      }

      setStatus('success');
    } catch (err) {
      console.error("Verification error:", err);
      setStatus('error');
      // Set a user-friendly error message
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
        <meta name="description" content="Verify your email address for U-Fill Dumpsters securely." />
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
              {status === 'verifying' && (
                <div className="py-8">
                  <div className="relative w-20 h-20 mx-auto mb-6">
                    <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-yellow-400 rounded-full border-t-transparent animate-spin"></div>
                    <ShieldCheck className="absolute inset-0 m-auto h-8 w-8 text-yellow-400" />
                  </div>
                  <h1 className="text-3xl font-bold text-white mb-2">Verifying Code</h1>
                  <p className="text-gray-300">Please wait while we securely verify your credentials...</p>
                </div>
              )}

              {status === 'success' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="py-6">
                  <div className="mx-auto w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mb-6 border border-green-500/30">
                    <CheckCircle2 className="h-10 w-10 text-green-400" />
                  </div>
                  <h1 className="text-3xl font-bold text-white mb-3">Email Verified!</h1>
                  <p className="text-gray-300 mb-8 leading-relaxed">
                    Your email address has been successfully verified. Your account is now secure and ready to use.
                  </p>
                  <div className="space-y-4">
                    <Button asChild className="w-full bg-yellow-400 text-black hover:bg-yellow-500 font-bold py-6 text-lg transition-transform hover:scale-[1.02]">
                      <Link to="/login">
                        Go to Customer Portal
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" className="w-full text-blue-200 hover:text-white hover:bg-white/5 py-6">
                      <Link to="/">Return to Homepage</Link>
                    </Button>
                  </div>
                </motion.div>
              )}

              {(status === 'idle' || status === 'error') && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4">
                  <div className="mx-auto w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mb-6 border border-blue-500/30">
                    <KeyRound className="h-8 w-8 text-blue-400" />
                  </div>
                  <h1 className="text-2xl font-bold text-white mb-2">Enter Verification Code</h1>
                  <p className="text-gray-400 text-sm mb-6">
                    Please enter the 6-digit code sent to your email address.
                  </p>

                  {status === 'error' && errorMessage && (
                    <div className="mb-6 p-4 bg-red-900/40 rounded-xl border border-red-500/50 flex items-start text-left">
                      <XCircle className="h-5 w-5 text-red-400 mt-0.5 mr-3 flex-shrink-0" />
                      <p className="text-red-200 text-sm">{errorMessage}</p>
                    </div>
                  )}

                  <form onSubmit={onManualSubmit} className="space-y-6">
                    <div>
                      <Input
                        type="text"
                        placeholder="e.g. 123456"
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
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white py-6 text-lg font-semibold"
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
                    Didn't receive the email? Check your spam folder or 
                    <Link to="/login" className="text-blue-400 hover:text-blue-300 ml-1 font-medium underline underline-offset-2">
                      request a new one
                    </Link>.
                  </div>
                </motion.div>
              )}

            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default VerifyEmailPage;