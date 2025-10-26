import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Loader2, ShieldCheck, KeyRound, Phone, HelpCircle, Mail, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const ForgotLoginDialog = ({ open, onOpenChange }) => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);

    const handleForgotSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const { error } = await supabase.functions.invoke('send-customer-id', {
                body: { email }
            });
            if (error) {
                const errorData = await error.context.json();
                throw new Error(errorData.error);
            }
            toast({
                title: 'Check Your Email!',
                description: 'If an account with that email exists, your login info has been sent.',
            });
            onOpenChange(false);
            setEmail('');
        } catch (error) {
            toast({
                title: 'Error',
                description: error.message || 'Could not process request. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-gray-900 border-yellow-400 text-white">
                <DialogHeader>
                    <DialogTitle>Forgot Your Login?</DialogTitle>
                    <DialogDescription>
                        Enter your email address below. If it matches an account in our system, we'll send you your Customer ID.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleForgotSubmit} className="space-y-4 pt-4">
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
                            className="bg-white/10 border-white/20 placeholder:text-gray-400"
                        />
                    </div>
                    <DialogFooter>
                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Send My Info
                        </Button>
                    </DialogFooter>
                </form>
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
                const errorContext = await functionError.context.json();
                throw new Error(errorContext.error || 'Could not verify your account details.');
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
                                    className="bg-white/10 border-white/20 placeholder:text-gray-400"
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
                                    className="bg-white/10 border-white/20 placeholder:text-gray-400"
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