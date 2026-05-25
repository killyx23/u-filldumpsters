import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Loader2, CheckCircle2, X, Calendar, DollarSign, RotateCcw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { ReturningCustomerLoyaltyBadge } from '@/components/ReturningCustomerLoyaltyBadge';
import { format } from 'date-fns';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';

export const ReturningCustomerSignIn = ({ isOpen, onClose, onReorderSelect, onStartNewOrder }) => {
  const [status, setStatus] = useState('idle'); // idle, sending, sent, verifying, authenticated
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [customerData, setCustomerData] = useState(null);
  const [pastBookings, setPastBookings] = useState([]);

  const handleSendCode = async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [ReturningCustomerSignIn] Sending verification code to:`, email);

    if (!email || !email.includes('@')) {
      toast({
        title: 'Invalid Email',
        description: 'Please enter a valid email address.',
        variant: 'destructive'
      });
      return;
    }

    setStatus('sending');

    try {
      const { data, error } = await supabase.functions.invoke('send-verification-email', {
        body: {
          email: email.toLowerCase().trim(),
          name: 'Valued Customer',
          pending_customer_id: null
        }
      });

      const responseTs = new Date().toISOString();
      console.log(`[${responseTs}] [ReturningCustomerSignIn] send-verification-email response:`, { data, error });

      if (error) {
        console.error(`[${responseTs}] [ReturningCustomerSignIn] Error:`, error);
        throw new Error('Failed to send verification code');
      }

      setStatus('sent');
      toast({
        title: 'Code Sent',
        description: `We sent a verification code to ${email}. Please check your inbox.`
      });

    } catch (err) {
      const catchTs = new Date().toISOString();
      console.error(`[${catchTs}] [ReturningCustomerSignIn] Exception:`, err);
      setStatus('idle');
      toast({
        title: 'Failed to send code',
        description: err.message || 'An error occurred while sending the verification code.',
        variant: 'destructive'
      });
    }
  };

  const handleVerifyCode = async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [ReturningCustomerSignIn] Verifying code:`, code);

    const trimmedCode = code.trim();
    if (!trimmedCode || trimmedCode.length !== 6) {
      toast({
        title: 'Invalid Code',
        description: 'Please enter the complete 6-digit verification code.',
        variant: 'destructive'
      });
      return;
    }

    setStatus('verifying');

    try {
      const normalizedEmail = email.toLowerCase().trim();
      const { data, error } = await supabase.functions.invoke('verify-email-code', {
        body: { email: normalizedEmail, code: trimmedCode }
      });

      const responseTs = new Date().toISOString();
      console.log(`[${responseTs}] [ReturningCustomerSignIn] verify-email-code response:`, { data, error });

      if (error) {
        console.error(`[${responseTs}] [ReturningCustomerSignIn] Verification failed:`, error);
        throw new Error(await parseEdgeFunctionError(error, data));
      }
      if (!data?.success) {
        console.error(`[${responseTs}] [ReturningCustomerSignIn] Verification failed:`, data?.error);
        throw new Error(data?.error || 'Invalid verification code');
      }

      // Fetch customer data
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();

      console.log(`[${responseTs}] [ReturningCustomerSignIn] Customer data:`, customer);

      if (customerError) {
        console.error(`[${responseTs}] [ReturningCustomerSignIn] Customer fetch error:`, customerError);
      }

      // Fetch past bookings
      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .order('created_at', { ascending: false })
        .limit(5);

      console.log(`[${responseTs}] [ReturningCustomerSignIn] Past bookings:`, bookings);

      if (bookingsError) {
        console.error(`[${responseTs}] [ReturningCustomerSignIn] Bookings fetch error:`, bookingsError);
      }

      setCustomerData(customer || { name: email.split('@')[0], email });
      setPastBookings(bookings || []);
      setStatus('authenticated');

      toast({
        title: 'Welcome Back!',
        description: 'Your account has been verified.',
        duration: 3000
      });

    } catch (err) {
      const catchTs = new Date().toISOString();
      console.error(`[${catchTs}] [ReturningCustomerSignIn] Exception:`, err);
      setStatus('sent');
      setCode('');
      toast({
        title: 'Verification Failed',
        description: err.message || 'Invalid or expired code. Please try again.',
        variant: 'destructive'
      });
    }
  };

  const handleReorder = (booking) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [ReturningCustomerSignIn] Reordering booking:`, booking.id);

    if (onReorderSelect) {
      onReorderSelect(booking);
    }

    onClose();
  };

  const handleNewOrder = () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [ReturningCustomerSignIn] Starting new order`);

    if (onStartNewOrder) {
      onStartNewOrder();
    }

    onClose();
  };

  const formatDate = (dateStr) => {
    try {
      return format(new Date(dateStr), 'MMM d, yyyy');
    } catch {
      return 'N/A';
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50 }}
      className="container mx-auto px-4 py-8 mb-8"
    >
      <Card className="bg-gradient-to-br from-blue-900/40 via-purple-900/30 to-blue-900/40 border-2 border-blue-500/50 shadow-2xl backdrop-blur-sm max-w-4xl mx-auto">
        <CardContent className="p-6 md:p-8">
          <div className="flex items-center justify-between mb-6 border-b border-white/20 pb-4">
            <h2 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-2">
              <Mail className="h-7 w-7 text-blue-400" />
              Returning Customer Sign In
            </h2>
            <Button
              onClick={onClose}
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <AnimatePresence mode="wait">
            {status === 'idle' && (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <p className="text-gray-300 text-center mb-6">
                  Already a customer? Sign in to access your order history and enjoy exclusive benefits!
                </p>

                <div className="space-y-2">
                  <Input
                    type="email"
                    placeholder="your.email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleSendCode();
                      }
                    }}
                    className="bg-white/10 border-white/30 text-white placeholder:text-gray-400 h-12 text-base"
                    autoFocus
                  />
                </div>

                <Button
                  onClick={handleSendCode}
                  className="w-full py-6 text-lg font-bold bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Send Verification Code
                </Button>

                <div className="text-center pt-4">
                  <Button
                    variant="link"
                    onClick={handleNewOrder}
                    className="text-gray-400 hover:text-white text-sm"
                  >
                    New customer? Start a fresh booking instead
                  </Button>
                </div>
              </motion.div>
            )}

            {status === 'sending' && (
              <motion.div
                key="sending"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-12"
              >
                <Loader2 className="h-12 w-12 animate-spin text-blue-400 mb-4" />
                <p className="text-white font-semibold">Sending verification code...</p>
              </motion.div>
            )}

            {status === 'sent' && (
              <motion.div
                key="sent"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <div className="bg-black/30 p-5 rounded-lg border border-blue-500/30">
                  <p className="text-sm text-blue-200 mb-4 text-center">
                    Enter the 6-digit code sent to <strong className="text-yellow-300">{email}</strong>
                  </p>
                  <Input
                    type="text"
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && code.length >= 5) {
                        handleVerifyCode();
                      }
                    }}
                    className="text-center text-2xl tracking-[0.5em] h-14 bg-white/10 border-white/30 text-white font-mono placeholder:text-gray-500"
                    autoFocus
                  />
                </div>

                <Button
                  onClick={handleVerifyCode}
                  disabled={code.length < 5}
                  className="w-full py-6 text-lg font-bold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Verify & Continue
                </Button>

                <div className="flex justify-center gap-4 pt-2">
                  <Button
                    variant="link"
                    onClick={handleSendCode}
                    className="text-gray-400 hover:text-white text-sm"
                  >
                    Resend Code
                  </Button>
                  <Button
                    variant="link"
                    onClick={() => { setStatus('idle'); setCode(''); }}
                    className="text-gray-400 hover:text-white text-sm"
                  >
                    Change Email
                  </Button>
                </div>
              </motion.div>
            )}

            {status === 'verifying' && (
              <motion.div
                key="verifying"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-12"
              >
                <Loader2 className="h-12 w-12 animate-spin text-green-400 mb-4" />
                <p className="text-white font-semibold">Verifying your account...</p>
              </motion.div>
            )}

            {status === 'authenticated' && (
              <motion.div
                key="authenticated"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <ReturningCustomerLoyaltyBadge
                  embedded
                  customerName={customerData.first_name || customerData.name || 'Valued Customer'}
                  bookingCount={pastBookings.length}
                />

                {pastBookings.length > 0 ? (
                  <div className="space-y-4">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-blue-400" />
                      Your Recent Orders
                    </h3>

                    <div className="grid grid-cols-1 gap-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
                      {pastBookings.map((booking) => (
                        <motion.div
                          key={booking.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="bg-black/30 rounded-lg border border-white/10 p-4 hover:border-blue-500/50 transition-all"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 space-y-2">
                              <h4 className="font-semibold text-white text-lg">
                                {booking.plan?.name || 'Service'}
                              </h4>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-300">
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {formatDate(booking.drop_off_date)}
                                </span>
                                <span className="flex items-center gap-1">
                                  <DollarSign className="h-3 w-3" />
                                  ${Number(booking.total_price || 0).toFixed(2)}
                                </span>
                              </div>
                              {booking.addons?.equipment && booking.addons.equipment.length > 0 && (
                                <p className="text-xs text-blue-300">
                                  + {booking.addons.equipment.length} Add-on(s)
                                </p>
                              )}
                            </div>

                            <div className="flex flex-col gap-2 flex-shrink-0">
                              <Button
                                onClick={() => handleReorder(booking)}
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white whitespace-nowrap"
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                Reorder
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-6 text-center">
                    <p className="text-yellow-200 mb-4">
                      We couldn't find any previous orders for this email address.
                    </p>
                    <p className="text-sm text-gray-300">
                      If you're a returning customer but don't see your orders, they may have been placed under a different email.
                    </p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-white/20">
                  <Button
                    onClick={handleNewOrder}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-6 text-base font-semibold"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Start New Booking
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
};