import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Mail, ShieldCheck, Loader2, CheckCircle2, Calendar, MapPin, Package, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { format, isValid } from 'date-fns';
import { useInsurancePricing } from '@/hooks/useInsurancePricing';

export const VerifyEmailBeforeBooking = ({ bookingData, addonsData, plan, totalPrice, onBack, onComplete, isProcessing }) => {
    const [status, setStatus] = useState('initial');
    const [code, setCode] = useState('');
    const { insurancePrice } = useInsurancePricing();

    const handleSendCode = async () => {
        setStatus('sending');
        try {
            const { data, error } = await supabase.functions.invoke('send-verification-email', {
                body: { email: bookingData.email, name: `${bookingData.firstName} ${bookingData.lastName}`.trim() }
            });
            if (error) {
              const errData = await error.context?.json().catch(()=>null);
              throw new Error(errData?.error || error.message);
            }
            setStatus('sent');
            toast({ title: 'Code Sent', description: `We sent a verification code to ${bookingData.email}.` });
        } catch (err) {
            console.error("[VerifyEmailBeforeBooking] Send error:", err);
            setStatus('initial');
            toast({ title: 'Failed to send code', description: err.message || 'An error occurred.', variant: 'destructive' });
        }
    };

    const handleVerify = async () => {
        if (!code || code.length < 5) return;
        setStatus('verifying');
        try {
            const { data, error } = await supabase.functions.invoke('verify-email-code', {
                body: { email: bookingData.email, code }
            });
            if (error) {
              const errData = await error.context?.json().catch(()=>null);
              throw new Error(errData?.error || error.message);
            }
            if (!data.success) throw new Error(data.error || 'Invalid code');
            
            setStatus('verified');
            onComplete();
        } catch (err) {
            console.error("[VerifyEmailBeforeBooking] Verify error:", err);
            setStatus('sent');
            toast({ title: 'Verification Failed', description: err.message || 'Invalid or expired code.', variant: 'destructive' });
        }
    };

    const formatTime = (timeString) => {
        if (!timeString) return '';
        try {
            const [hours, minutes] = timeString.split(':');
            const date = new Date();
            date.setHours(parseInt(hours, 10));
            date.setMinutes(parseInt(minutes || '0', 10));
            return isValid(date) ? format(date, 'h:mm a') : timeString;
        } catch (e) {
            return timeString;
        }
    };

    // Calculate Breakdown Values accurately without fake processing fees
    const insuranceCost = addonsData?.insurance === 'accept' ? insurancePrice : 0;
    const drivewayCost = addonsData?.drivewayProtection === 'accept' ? 15 : 0;
    const equipmentCost = addonsData?.equipment?.reduce((acc, eq) => acc + ((eq.price || 0) * (eq.quantity || 1)), 0) || 0;
    
    // Calculate disposal costs if any
    const mattressCost = (addonsData?.mattressDisposal || 0) * 25;
    const tvCost = (addonsData?.tvDisposal || 0) * 15;
    const applianceCost = (addonsData?.applianceDisposal || 0) * 35;
    
    const deliveryCost = addonsData?.deliveryFee || bookingData?.deliveryFee || 0;
    const distanceCost = addonsData?.mileageCharge || bookingData?.distanceFee || 0;
    
    // Calculate accurate plan cost by subtracting all known addons from the exact total passed down
    const totalKnownAddons = insuranceCost + drivewayCost + equipmentCost + deliveryCost + distanceCost + mattressCost + tvCost + applianceCost;
    const planCost = plan?.price || plan?.base_price || (totalPrice - totalKnownAddons);

    return (
        <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="container mx-auto py-16 px-4"
        >
            <div className="max-w-4xl mx-auto bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
                <div className="flex items-center mb-8 border-b border-white/10 pb-4">
                    <Button onClick={onBack} variant="ghost" size="icon" className="mr-4 text-white hover:bg-white/20" disabled={isProcessing || status === 'verifying'}>
                        <ArrowLeft />
                    </Button>
                    <h2 className="text-3xl font-bold text-white flex items-center">
                        <ShieldCheck className="mr-3 h-8 w-8 text-yellow-400" />
                        Verify Email
                    </h2>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                    {/* Summary Section */}
                    <div className="bg-black/20 p-6 rounded-xl border border-white/10 space-y-4 text-sm">
                        <h3 className="text-lg font-bold text-yellow-400 border-b border-white/10 pb-2 mb-4 flex items-center">
                            <Receipt className="h-5 w-5 mr-2" /> Booking Summary
                        </h3>
                        
                        <div className="flex items-start text-gray-200">
                            <Package className="h-5 w-5 mr-3 text-blue-400 mt-0.5" />
                            <div>
                                <p className="font-semibold text-white">{plan?.name || 'Selected Plan'}</p>
                                {addonsData?.equipment?.length > 0 && <p className="text-gray-400">+ {addonsData.equipment.length} Add-on(s)</p>}
                            </div>
                        </div>

                        <div className="flex items-start text-gray-200">
                            <Calendar className="h-5 w-5 mr-3 text-green-400 mt-0.5" />
                            <div>
                                <p><span className="text-white">Drop-off:</span> {bookingData.dropOffDate ? format(new Date(bookingData.dropOffDate), 'MMM d, yyyy') : 'N/A'} {bookingData.dropOffTimeSlot && `(${formatTime(bookingData.dropOffTimeSlot)})`}</p>
                                {bookingData.pickupDate && (
                                    <p><span className="text-white">Pickup:</span> {format(new Date(bookingData.pickupDate), 'MMM d, yyyy')} {bookingData.pickupTimeSlot && `(${formatTime(bookingData.pickupTimeSlot)})`}</p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-start text-gray-200">
                            <MapPin className="h-5 w-5 mr-3 text-red-400 mt-0.5" />
                            <div>
                                <p>{bookingData.street || addonsData?.deliveryAddress?.street}</p>
                                <p>{bookingData.city || addonsData?.deliveryAddress?.city}, {bookingData.state || addonsData?.deliveryAddress?.state} {bookingData.zip || addonsData?.deliveryAddress?.zip}</p>
                            </div>
                        </div>

                        {/* Itemized Breakdown */}
                        <div className="mt-6 pt-4 border-t border-white/10 space-y-2 text-gray-300">
                            <h4 className="text-white font-semibold mb-2">Cost Breakdown</h4>
                            
                            <div className="flex justify-between">
                                <span>Rental/Plan Cost:</span>
                                <span>${Math.max(0, planCost).toFixed(2)}</span>
                            </div>
                            
                            {insuranceCost > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Insurance/Protection:</span>
                                    <span>${insuranceCost.toFixed(2)}</span>
                                </div>
                            )}
                            
                            {drivewayCost > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Driveway Protection:</span>
                                    <span>${drivewayCost.toFixed(2)}</span>
                                </div>
                            )}
                            
                            {equipmentCost > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Equipment Add-ons:</span>
                                    <span>${equipmentCost.toFixed(2)}</span>
                                </div>
                            )}
                            
                            {mattressCost > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Mattress Disposal:</span>
                                    <span>${mattressCost.toFixed(2)}</span>
                                </div>
                            )}
                            
                            {tvCost > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>TV Disposal:</span>
                                    <span>${tvCost.toFixed(2)}</span>
                                </div>
                            )}
                            
                            {applianceCost > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Appliance Disposal:</span>
                                    <span>${applianceCost.toFixed(2)}</span>
                                </div>
                            )}
                            
                            {deliveryCost > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Delivery Fee (Flat):</span>
                                    <span>${deliveryCost.toFixed(2)}</span>
                                </div>
                            )}
                            
                            {distanceCost > 0 && (
                                <div className="flex justify-between text-blue-300">
                                    <span>Distance/Mileage Fee:</span>
                                    <span>${distanceCost.toFixed(2)}</span>
                                </div>
                            )}
                        </div>

                        <div className="mt-4 pt-4 border-t border-white/10">
                            <div className="flex justify-between items-center text-lg">
                                <span className="font-semibold text-white">Estimated Total:</span>
                                <span className="font-bold text-green-400">${totalPrice.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Verification Section */}
                    <div className="flex flex-col justify-center space-y-6">
                        <div className="text-center">
                            <Mail className="mx-auto h-12 w-12 text-blue-400 mb-4" />
                            <h3 className="text-xl font-bold text-white mb-2">Verify Your Email</h3>
                            <p className="text-gray-300 text-sm">
                                We need to verify <strong className="text-yellow-300">{bookingData.email}</strong> to secure your booking and send your receipt.
                            </p>
                        </div>

                        <AnimatePresence mode="wait">
                            {status === 'initial' && (
                                <motion.div key="initial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                    <Button onClick={handleSendCode} className="w-full py-6 text-lg font-bold bg-blue-600 hover:bg-blue-700 text-white">
                                        Send Verification Code
                                    </Button>
                                </motion.div>
                            )}

                            {(status === 'sending' || status === 'verifying' || isProcessing) && status !== 'verified' && (
                                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center p-6 text-yellow-400">
                                    <Loader2 className="h-10 w-10 animate-spin mb-4" />
                                    <p className="font-semibold text-white">
                                        {status === 'sending' ? 'Sending code to your email...' : 
                                         status === 'verifying' ? 'Verifying your code...' : 'Preparing secure payment...'}
                                    </p>
                                </motion.div>
                            )}

                            {status === 'sent' && (
                                <motion.div key="sent" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                                    <div className="bg-black/30 p-4 rounded-lg border border-blue-500/30">
                                        <p className="text-sm text-blue-200 mb-3 text-center">Enter the 6-digit code sent to your email</p>
                                        <Input
                                            type="text"
                                            maxLength={6}
                                            placeholder="123456"
                                            value={code}
                                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                            className="text-center text-2xl tracking-[0.5em] h-14 bg-white/10 border-white/30 text-white font-mono placeholder:text-gray-500"
                                        />
                                    </div>
                                    
                                    <Button onClick={handleVerify} disabled={code.length < 5} className="w-full py-6 text-lg font-bold bg-green-600 hover:bg-green-700 text-white">
                                        Verify & Complete
                                    </Button>
                                    
                                    <div className="text-center mt-2">
                                        <Button variant="link" onClick={handleSendCode} className="text-gray-400 hover:text-white text-sm">
                                            Didn't receive a code? Resend
                                        </Button>
                                    </div>
                                </motion.div>
                            )}

                            {status === 'verified' && isProcessing && (
                                <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center p-6">
                                    <CheckCircle2 className="h-12 w-12 text-green-400 mb-4" />
                                    <h3 className="text-xl font-bold text-white mb-2">Email Verified!</h3>
                                    <p className="text-gray-300 text-center flex items-center">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Preparing secure payment...
                                    </p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};