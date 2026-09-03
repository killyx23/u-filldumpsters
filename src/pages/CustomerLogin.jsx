
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ShieldCheck, KeyRound, Phone, HelpCircle, Mail, ArrowRight, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getAppOrigin } from '@/utils/getAppOrigin';
import { markVerifiedEmailSession } from '@/utils/checkoutEmailVerification';
import { mapCustomerToBookingData } from '@/utils/returningCustomerMapper';

const formatPhoneDigits = (rawDigits) => {
    const input = String(rawDigits || '').replace(/\D/g, '');
    let formattedPhone = '';
    if (input.length > 0) {
        formattedPhone = `(${input.substring(0, 3)}`;
    }
    if (input.length > 3) {
        formattedPhone += `) ${input.substring(3, 6)}`;
    }
    if (input.length > 6) {
        formattedPhone += `-${input.substring(6, 10)}`;
    }
    return formattedPhone;
};

const ForgotLoginDialog = ({ open, onOpenChange, onRecoveryComplete, initialCode = '', initialEmail = '' }) => {
    const [email, setEmail] = useState('');
    const [step, setStep] = useState('email');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [cooldown, setCooldown] = useState(0);

    useEffect(() => {
        if (open) {
            if (initialEmail) setEmail(initialEmail);
            if (initialCode) setCode(initialCode);
            if (initialCode && initialEmail) {
                setStep('verify');
            } else {
                setStep('email');
            }
        }
    }, [open, initialCode, initialEmail]);

    useEffect(() => {
        let timer;
        if (cooldown > 0) {
            timer = setInterval(() => setCooldown(c => c - 1), 1000);
        }
        return () => clearInterval(timer);
    }, [cooldown]);

    const handleSendCode = async (e) => {
        if (e) e.preventDefault();
        setLoading(true);
        try {
            if (code.length === 6 && email) {
                setStep('verify');
                setLoading(false);
                return;
            }

            const { data, error } = await supabase.functions.invoke('send-verification-email', {
                body: { email, purpose: 'portal', site_url: getAppOrigin() }
            });
            
            if (error) {
              const errContext = await error.context?.json().catch(()=>null);
              throw new Error(errContext?.error || error.message);
            }
            if (!data.success) throw new Error(data.error || "Failed to send verification code");

            toast({
                title: 'Code Sent!',
                description: 'Check your email for a verification code.',
            });
            setStep('verify');
            setCooldown(30);
        } catch (error) {
            console.error("[CustomerLogin] Send code error:", error);
            toast({
                title: 'Error sending code',
                description: error.message || 'Could not send verification code. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyCode = async (e) => {
        e.preventDefault();
        if (!code || code.length !== 6) return;
        
        setLoading(true);
        try {
            const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-email-code', {
                body: { email, code }
            });

            if (verifyError) {
              const errContext = await verifyError.context?.json().catch(()=>null);
              throw new Error(errContext?.error || verifyError.message);
            }
            if (!verifyData.success) throw new Error(verifyData.error || "Invalid code");

            onOpenChange(false);
            resetDialog();
            await onRecoveryComplete(verifyData.customer, email);

        } catch (error) {
            console.error("[CustomerLogin] Verify code error:", error);
            toast({
                title: 'Verification Failed',
                description: error.message || 'Invalid or expired code.',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const resetDialog = () => {
        setStep('email');
        setCode('');
        setEmail('');
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => {
            if (!isOpen) resetDialog();
            onOpenChange(isOpen);
        }}>
            <DialogContent className="bg-gray-900 border-yellow-400 text-white max-w-md">
                <DialogHeader>
                    <DialogTitle>Forgot Your Login?</DialogTitle>
                    <DialogDescription>
                        {step === 'email' && (initialCode
                            ? "Enter the email address this verification code was sent to."
                            : "Enter your email address. We'll send a 6-digit verification code to securely retrieve your Customer ID.")}
                        {step === 'verify' && `We sent a 6-digit code to ${email}. Check your inbox and enter it below.`}
                    </DialogDescription>
                </DialogHeader>

                <div className="pt-4">
                    <AnimatePresence mode="wait">
                        {step === 'email' && (
                            <motion.form 
                                key="email-step"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                onSubmit={handleSendCode} 
                                className="space-y-4"
                            >
                                <div className="space-y-2">
                                    <Label htmlFor="forgot-email" className="text-gray-200 flex items-center">
                                        <Mail className="w-4 h-4 mr-2" />
                                        Email Address
                                    </Label>
                                    <Input
                                        id="forgot-email"
                                        type="email"
                                        placeholder="you@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        className="bg-white/10 border-white/20 placeholder:text-gray-400 text-white"
                                    />
                                </div>
                                <DialogFooter>
                                    <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white" disabled={loading || !email}>
                                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        {initialCode ? 'Continue' : 'Send Verification Code'}
                                    </Button>
                                </DialogFooter>
                            </motion.form>
                        )}

                        {step === 'verify' && (
                            <motion.form 
                                key="verify-step"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                onSubmit={handleVerifyCode} 
                                className="space-y-6"
                            >
                                <div className="space-y-2">
                                    <Label htmlFor="verification-code" className="text-gray-200 flex items-center">
                                        <LockKeyhole className="w-4 h-4 mr-2" />
                                        6-Digit Code
                                    </Label>
                                    <Input
                                        id="verification-code"
                                        type="text"
                                        placeholder="123456"
                                        maxLength={6}
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                        required
                                        className="bg-white/10 border-white/20 placeholder:text-gray-500 text-center tracking-[0.5em] text-2xl font-mono text-white h-14"
                                    />
                                </div>
                                <div className="flex flex-col space-y-3">
                                    <Button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white h-12 text-lg" disabled={loading || code.length !== 6}>
                                        {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                                        Verify Code
                                    </Button>
                                    <Button 
                                        type="button" 
                                        variant="outline" 
                                        className="w-full bg-transparent border-white/20 text-gray-300" 
                                        onClick={() => handleSendCode()}
                                        disabled={loading || cooldown > 0}
                                    >
                                        {cooldown > 0 ? `Resend Code (${cooldown}s)` : 'Resend Code'}
                                    </Button>
                                    <Button type="button" variant="link" onClick={() => setStep('email')} className="text-xs text-gray-400">
                                        Use a different email
                                    </Button>
                                </div>
                            </motion.form>
                        )}
                    </AnimatePresence>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export const CustomerLogin = () => {
    const [customerId, setCustomerId] = useState('');
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);
    const [recoveringFromUrl, setRecoveringFromUrl] = useState(false);
    const [isForgotDialogOpen, setIsForgotDialogOpen] = useState(false);
    const [forgotInitialCode, setForgotInitialCode] = useState('');
    const [forgotInitialEmail, setForgotInitialEmail] = useState('');
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const urlRecoveryStarted = useRef(false);

    const applyCredentials = useCallback((cid, rawPhone) => {
        if (cid) setCustomerId(cid);
        if (rawPhone) setPhone(formatPhoneDigits(rawPhone));
    }, []);

    const attemptPortalLogin = useCallback(async (cid, rawPhone) => {
        const requestPayload = {
            portal_number: cid.trim(),
            customerId: cid.trim(),
            phone: rawPhone,
        };

        const { data: functionData, error: functionError } = await supabase.functions.invoke('customer-portal-login', {
            body: requestPayload
        });

        if (functionError) {
            let errorMessage = functionError.message;
            try {
                const errorContext = await functionError.context?.json();
                if (errorContext?.error) {
                    errorMessage = errorContext.error;
                }
            } catch {
                // ignore parse errors
            }
            throw new Error(errorMessage || 'Could not verify your account details.');
        }

        if (functionData?.error) {
            throw new Error(functionData.error);
        }

        if (!functionData?.session) {
            throw new Error('Could not create a session. Please try again.');
        }

        const { error: sessionError } = await supabase.auth.setSession(functionData.session);
        if (sessionError) throw sessionError;

        toast({
            title: 'Login Successful!',
            description: 'Redirecting you to your portal...',
        });
        navigate('/customer-portal');
        return true;
    }, [navigate]);

    const redirectToReturningCustomerFlow = useCallback((customer, email) => {
        const normalizedEmail = String(email || customer?.email || '').trim().toLowerCase();
        if (normalizedEmail) {
            markVerifiedEmailSession(normalizedEmail);
        }

        const mapped = mapCustomerToBookingData(customer, normalizedEmail);
        toast({
            title: 'Email Verified',
            description: 'Taking you to your returning customer options…',
        });
        // Already verified — apply profile via location state (do not re-open OTP via flow=returning).
        navigate('/', {
            replace: true,
            state: {
                returningCustomerProfile: {
                    customer: {
                        id: mapped.contactAddress?.customerId || customer?.id || null,
                        first_name: mapped.firstName || customer?.first_name || '',
                        last_name: mapped.lastName || customer?.last_name || '',
                        email: normalizedEmail,
                        phone: mapped.phone || customer?.phone || '',
                        street: mapped.contactAddress?.street || customer?.street || '',
                        city: mapped.contactAddress?.city || customer?.city || '',
                        state: mapped.contactAddress?.state || customer?.state || '',
                        zip: mapped.contactAddress?.zip || customer?.zip || '',
                    },
                    email: normalizedEmail,
                },
            },
        });
    }, [navigate]);

    const completePortalRecovery = useCallback(async (customer, verifiedEmail = '') => {
        if (!customer?.customer_id_text || !customer?.phone) {
            // Old returning-customer email links landed here; send them home instead of "invalid login".
            redirectToReturningCustomerFlow(customer, verifiedEmail || customer?.email);
            return;
        }

        const cid = customer.customer_id_text;
        const rawPhone = String(customer.phone).replace(/\D/g, '');

        setLoading(true);
        try {
            await attemptPortalLogin(cid, rawPhone);
        } catch (error) {
            console.error('[CustomerLogin] Recovery auto-login failed; falling back to returning-customer flow:', error);
            const message = String(error?.message || '').toLowerCase();
            const looksLikeInvalidPortal =
                message.includes('invalid customer id') ||
                message.includes('invalid phone') ||
                message.includes('could not verify');

            if (looksLikeInvalidPortal) {
                redirectToReturningCustomerFlow(customer, verifiedEmail || customer?.email);
                return;
            }

            applyCredentials(cid, rawPhone);
            toast({
                title: 'Credentials Ready',
                description: 'Your Customer ID and phone have been filled in. Tap Login to Portal to continue.',
            });
        } finally {
            setLoading(false);
        }
    }, [attemptPortalLogin, applyCredentials, redirectToReturningCustomerFlow]);

    useEffect(() => {
        const cid = searchParams.get('cid');
        const portalId = searchParams.get('portal_id');
        const portalNumber = searchParams.get('portal_number');
        const ph = searchParams.get('phone');
        const code = searchParams.get('code');
        const email = searchParams.get('email')?.trim().toLowerCase() ?? null;
        
        const foundId = cid || portalNumber || portalId;
        if (foundId) {
            setCustomerId(foundId);
        }
        if (ph) {
            setPhone(formatPhoneDigits(ph));
        }

        if (code && email && !urlRecoveryStarted.current) {
            urlRecoveryStarted.current = true;
            setRecoveringFromUrl(true);
            navigate('/customer-login', { replace: true });

            (async () => {
                try {
                    const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-email-code', {
                        body: { email, code }
                    });

                    if (verifyError) {
                        const errContext = await verifyError.context?.json().catch(() => null);
                        throw new Error(errContext?.error || verifyError.message);
                    }
                    if (!verifyData.success) {
                        throw new Error(verifyData.error || 'Invalid verification code');
                    }

                    await completePortalRecovery(verifyData.customer, email);
                } catch (error) {
                    console.error('[CustomerLogin] URL recovery error:', error);
                    // Prefer returning-customer home flow over "Forgot login / invalid login"
                    // when this looks like an old returning-customer email button link.
                    const recoverFlag = searchParams.get('recover');
                    if (recoverFlag === '1' && email) {
                        navigate(`/?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}&flow=returning`, {
                            replace: true,
                        });
                        return;
                    }
                    toast({
                        title: 'Verification Failed',
                        description: error.message || 'Could not verify your email link. Please try again.',
                        variant: 'destructive',
                    });
                    setForgotInitialCode(code);
                    setForgotInitialEmail(email);
                    setIsForgotDialogOpen(true);
                } finally {
                    setRecoveringFromUrl(false);
                }
            })();
        } else if (code && !email && !urlRecoveryStarted.current) {
            urlRecoveryStarted.current = true;
            setForgotInitialCode(code);
            setIsForgotDialogOpen(true);
            navigate('/customer-login', { replace: true });
        }
    }, [searchParams, navigate, completePortalRecovery]);

    const handlePhoneChange = (e) => {
        setPhone(formatPhoneDigits(e.target.value));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!customerId || !customerId.trim()) {
            toast({
                title: 'Missing Information',
                description: 'Please enter your Customer ID.',
                variant: 'destructive',
            });
            return;
        }

        const rawPhone = phone.replace(/\D/g, '');
        if (rawPhone.length !== 10) {
            toast({
                title: 'Invalid Phone Number',
                description: 'Please enter a valid 10-digit phone number.',
                variant: 'destructive',
            });
            return;
        }

        setLoading(true);

        try {
            await attemptPortalLogin(customerId.trim(), rawPhone);
        } catch (error) {
            console.error('[CustomerLogin] Login error:', error);
            toast({
                title: 'Login Failed',
                description: error.message || 'An unexpected error occurred.',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const isBusy = loading || recoveringFromUrl;

    return (
        <>
            <Helmet>
                <title>Customer Portal Login - U-Fill Dumpsters</title>
                <meta name="description" content="Access your U-Fill Dumpsters customer portal to manage your bookings and view your history." />
            </Helmet>
            <div className="min-h-[calc(100vh-200px)] flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5 }}
                    className="w-full max-w-md"
                >
                    <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                        <div className="text-center mb-8">
                            <ShieldCheck className="mx-auto h-16 w-16 text-yellow-400 mb-4" />
                            <h1 className="text-3xl font-bold text-white">Customer Portal</h1>
                            <p className="text-gray-300 mt-2">
                                {recoveringFromUrl
                                    ? 'Verifying your email link...'
                                    : 'Enter your credentials to access your portal.'}
                            </p>
                        </div>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="customer-id" className="text-gray-200 flex items-center"><KeyRound className="w-4 h-4 mr-2" />Customer ID</Label>
                                <Input
                                    id="customer-id"
                                    type="text"
                                    placeholder="e.g., CID-123456"
                                    value={customerId}
                                    onChange={(e) => setCustomerId(e.target.value)}
                                    required
                                    disabled={isBusy}
                                    className="bg-white/10 border-white/20 placeholder:text-gray-400 text-white"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone" className="text-gray-200 flex items-center"><Phone className="w-4 h-4 mr-2" />Phone Number</Label>
                                <Input
                                    id="phone"
                                    type="tel"
                                    placeholder="(555) 555-5555"
                                    value={phone}
                                    onChange={handlePhoneChange}
                                    required
                                    disabled={isBusy}
                                    className="bg-white/10 border-white/20 placeholder:text-gray-400 text-white"
                                />
                            </div>
                            <Button type="submit" className="w-full bg-yellow-400 text-black hover:bg-yellow-500 font-bold text-lg py-6" disabled={isBusy}>
                                {isBusy ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        {recoveringFromUrl ? 'Verifying...' : 'Logging in...'}
                                    </>
                                ) : (
                                    <>
                                    Login to Portal
                                    <ArrowRight className="ml-2 h-5 w-5" />
                                    </>
                                )}
                            </Button>
                        </form>
                        <div className="text-center mt-6">
                            <Button variant="link" className="text-yellow-300 hover:text-yellow-200" onClick={() => setIsForgotDialogOpen(true)} disabled={isBusy}>
                                <HelpCircle className="w-4 h-4 mr-2" />
                                Forgot your login info?
                            </Button>
                        </div>
                    </div>
                </motion.div>
            </div>
            <ForgotLoginDialog
                open={isForgotDialogOpen}
                onOpenChange={setIsForgotDialogOpen}
                onRecoveryComplete={completePortalRecovery}
                initialCode={forgotInitialCode}
                initialEmail={forgotInitialEmail}
            />
        </>
    );
};

export default CustomerLogin;
