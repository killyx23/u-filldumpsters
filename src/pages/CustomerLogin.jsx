import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ShieldCheck, KeyRound, Phone, HelpCircle, Mail, ArrowRight, CheckCircle2, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const ForgotLoginDialog = ({ open, onOpenChange }) => {
    const [email, setEmail] = useState('');
    const [step, setStep] = useState('email'); // 'email', 'verify', 'success'
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [cooldown, setCooldown] = useState(0);

    // Cooldown timer for resend
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
            const { data, error } = await supabase.functions.invoke('send-verification-email', {
                body: { email }
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
            setCooldown(30); // 30 second rate limit
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
            // 1. Verify the code
            const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-email-code', {
                body: { email, code }
            });

            if (verifyError) {
              const errContext = await verifyError.context?.json().catch(()=>null);
              throw new Error(errContext?.error || verifyError.message);
            }
            if (!verifyData.success) throw new Error(verifyData.error || "Invalid code");

            // 2. If valid, trigger the edge function to email their customer ID
            toast({ title: 'Code Verified', description: 'Requesting your Customer ID...' });
            
            const { error: sendIdError } = await supabase.functions.invoke('send-customer-id', {
                body: { email }
            });

            if (sendIdError) {
                const errorData = await sendIdError.context?.json().catch(()=>({}));
                throw new Error(errorData?.error || sendIdError.message);
            }

            setStep('success');
            toast({
                title: 'Success!',
                description: 'Your Customer ID has been securely sent to your email.',
            });
            
            // Auto close after 4 seconds
            setTimeout(() => {
                onOpenChange(false);
                setStep('email');
                setCode('');
                setEmail('');
            }, 4000);

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
                        {step === 'email' && "Enter your email address. We'll send a 6-digit verification code to securely retrieve your Customer ID."}
                        {step === 'verify' && `We sent a 6-digit code to ${email}. Check your inbox and enter it below.`}
                        {step === 'success' && "Verification complete!"}
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
                                        Send Verification Code
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

                        {step === 'success' && (
                            <motion.div 
                                key="success-step"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center justify-center py-6 text-center"
                            >
                                <CheckCircle2 className="h-16 w-16 text-green-400 mb-4" />
                                <h3 className="text-xl font-bold text-white mb-2">Check Your Email Again</h3>
                                <p className="text-gray-300 text-sm">
                                    If an account exists for {email}, we've securely sent your Customer ID. 
                                    You can use it to log in now.
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const CustomerLogin = () => {
    const [customerId, setCustomerId] = useState('');
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);
    const [isForgotDialogOpen, setIsForgotDialogOpen] = useState(false);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    useEffect(() => {
        const cid = searchParams.get('cid');
        const ph = searchParams.get('phone');
        if (cid) {
            setCustomerId(cid);
        }
        if (ph) {
            handlePhoneChange({ target: { value: ph } });
        }
    }, [searchParams]);

    const handlePhoneChange = (e) => {
        const input = e.target.value.replace(/\D/g, '');
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
        setPhone(formattedPhone);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const rawPhone = phone.replace(/\D/g, '');
        if (rawPhone.length !== 10) {
            toast({
                title: 'Invalid Phone Number',
                description: 'Please enter a valid 10-digit phone number.',
                variant: 'destructive',
            });
            setLoading(false);
            return;
        }

        try {
            const { data: functionData, error: functionError } = await supabase.functions.invoke('customer-portal-login', {
                body: { customerId, phone: rawPhone }
            });

            if (functionError) {
                const errorContext = await functionError.context?.json().catch(()=>({}));
                throw new Error(errorContext?.error || 'Could not verify your account details.');
            }
            if (functionData.error) {
                throw new Error(functionData.error);
            }

            const { data, error: signInError } = await supabase.auth.signInWithPassword({
                email: `${customerId}@ufilldumpsters.com`,
                password: rawPhone,
            });

            if (signInError) {
                 if (signInError.message.includes('Invalid login credentials')) {
                    throw new Error('Invalid credentials. Please double-check your Customer ID and Phone Number.');
                }
                throw signInError;
            }

            if (data.session) {
                toast({
                    title: 'Login Successful!',
                    description: 'Redirecting you to your portal...',
                });
                navigate('/portal');
            } else {
                throw new Error('Could not create a session. Please try again.');
            }

        } catch (error) {
            console.error('Login error:', error);
            toast({
                title: 'Login Failed',
                description: error.message || 'An unexpected error occurred.',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

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
                            <p className="text-gray-300 mt-2">Enter your credentials to access your portal.</p>
                        </div>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="customer-id" className="text-gray-200 flex items-center"><KeyRound className="w-4 h-4 mr-2" />Customer ID</Label>
                                <Input
                                    id="customer-id"
                                    type="text"
                                    placeholder="e.g., CID-123456"
                                    value={customerId}
                                    onChange={(e) => setCustomerId(e.target.value.trim())}
                                    required
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
                                    className="bg-white/10 border-white/20 placeholder:text-gray-400 text-white"
                                />
                            </div>
                            <Button type="submit" className="w-full bg-yellow-400 text-black hover:bg-yellow-500 font-bold text-lg py-6" disabled={loading}>
                                {loading ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        Logging in...
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
                            <Button variant="link" className="text-yellow-300 hover:text-yellow-200" onClick={() => setIsForgotDialogOpen(true)}>
                                <HelpCircle className="w-4 h-4 mr-2" />
                                Forgot your login info?
                            </Button>
                        </div>
                    </div>
                </motion.div>
            </div>
            <ForgotLoginDialog open={isForgotDialogOpen} onOpenChange={setIsForgotDialogOpen} />
        </>
    );
};

export default CustomerLogin;