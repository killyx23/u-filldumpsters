import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Loader2, CheckCircle2, Clock, DollarSign, FileText, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';

export const ReturningCustomerSignInSection = ({ onEmailChange, onReorderSelect }) => {
  const [mode, setMode] = useState('input'); // input, sending, sent, verifying, authenticated
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pastBookings, setPastBookings] = useState([]);
  const [customerData, setCustomerData] = useState(null);

  const handleEmailChange = (value) => {
    setEmail(value);
    if (onEmailChange) {
      onEmailChange(value);
    }
  };

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

    setMode('sending');

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

      setMode('sent');
      toast({
        title: 'Code Sent',
        description: `We sent a verification code to ${email}.`,
        duration: 3000
      });

    } catch (err) {
      const catchTs = new Date().toISOString();
      console.error(`[${catchTs}] [ReturningCustomerSignIn] Exception:`, err);
      setMode('input');
      toast({
        title: 'Failed to send code',
        description: err.message || 'An error occurred.',
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

    setMode('verifying');

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

      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();

      console.log(`[${responseTs}] [ReturningCustomerSignIn] Customer data:`, customer);

      if (customerError) {
        console.error(`[${responseTs}] [ReturningCustomerSignIn] Customer fetch error:`, customerError);
      }

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
      setMode('authenticated');

      toast({
        title: 'Verified!',
        description: `Welcome back${customer?.first_name ? ', ' + customer.first_name : ''}!`,
        duration: 3000
      });

    } catch (err) {
      const catchTs = new Date().toISOString();
      console.error(`[${catchTs}] [ReturningCustomerSignIn] Exception:`, err);
      setMode('sent');
      setCode('');
      toast({
        title: 'Verification Failed',
        description: err.message || 'Invalid code. Please try again.',
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

    toast({
      title: 'Order Pre-filled',
      description: 'Your previous booking details have been loaded.',
      duration: 3000
    });
  };

  const handleNewOrder = () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [ReturningCustomerSignIn] Starting new order`);
    
    setMode('input');
    setCode('');
    setPastBookings([]);
    setCustomerData(null);
  };

  const formatDate = (dateStr) => {
    try {
      return format(new Date(dateStr), 'MMM d, yyyy');
    } catch {
      return 'N/A';
    }
  };

  return (
    <div className="mb-8 mt-8">
      {/* Visual Separator */}
      <div className="returning-customer-separator mb-6">
        <div className="returning-customer-separator-line"></div>
        <span className="returning-customer-separator-text">OR</span>
        <div className="returning-customer-separator-line"></div>
      </div>

      {/* Returning Customer Section Container */}
      <div className="returning-customer-section-wrapper">
        {/* Prominent Header with Badge */}
        <div className="returning-customer-header">
          <div className="flex items-center justify-center gap-3 mb-2">
            <ShieldCheck className="h-7 w-7 text-yellow-400 animate-pulse-glow" />
            <h3 className="returning-customer-title">
              RETURNING CUSTOMERS ONLY
            </h3>
            <ShieldCheck className="h-7 w-7 text-yellow-400 animate-pulse-glow" />
          </div>
          
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="returning-customer-badge">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              <span>Existing Account Required</span>
            </div>
          </div>

          <p className="returning-customer-subtitle">
            Already placed an order with us? Sign in to view your bookings and reorder with one click.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {mode === 'input' && (
            <motion.div
              key="input"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 returning-customer-content"
            >
              <div>
                <Label htmlFor="returning-customer-email" className="text-base font-semibold text-white mb-2 block">
                  Enter Your Email to Sign In
                </Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-yellow-400" />
                  <Input
                    id="returning-customer-email"
                    type="email"
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSendCode();
                      }
                    }}
                    placeholder="your.email@example.com"
                    className="bg-blue-950/30 border-2 border-yellow-400/40 text-white pl-12 pr-4 py-3 text-base placeholder-yellow-200/40 focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/50 transition-all rounded-lg shadow-lg hover:border-yellow-400/60"
                    required
                  />
                </div>
              </div>

              <Button
                type="button"
                onClick={handleSendCode}
                disabled={!email || !email.includes('@')}
                className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-gray-900 font-bold py-3.5 text-base disabled:opacity-50 shadow-xl hover:shadow-2xl transition-all duration-300 rounded-lg border-2 border-yellow-400"
              >
                <ShieldCheck className="mr-2 h-5 w-5" />
                Sign In as Returning Customer
              </Button>

              <div className="returning-customer-info-box">
                <p className="text-xs text-center text-yellow-200/90 font-medium">
                  ⚠️ <strong>First-time customers:</strong> Please use the form above to create your account.
                </p>
              </div>
            </motion.div>
          )}

          {mode === 'sending' && (
            <motion.div
              key="sending"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center py-12 returning-customer-content"
            >
              <Loader2 className="h-10 w-10 animate-spin text-yellow-400 mr-3" />
              <span className="text-white text-base font-medium">Sending verification code...</span>
            </motion.div>
          )}

          {mode === 'sent' && (
            <motion.div
              key="sent"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4 returning-customer-content"
            >
              <div className="bg-yellow-500/20 p-4 rounded-xl border-2 border-yellow-500/40 shadow-lg">
                <p className="text-sm text-yellow-100 mb-3 text-center font-medium">
                  Enter the 6-digit verification code sent to <strong className="text-yellow-300">{email}</strong>
                </p>
                <Input
                  type="text"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && code.length >= 5) {
                      e.preventDefault();
                      handleVerifyCode();
                    }
                  }}
                  className="text-center text-xl tracking-[0.5em] h-14 bg-blue-950/50 border-2 border-yellow-400/50 text-white font-mono placeholder:text-gray-500 focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/50 rounded-lg shadow-lg"
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={code.length < 5}
                  className="flex-1 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-gray-900 py-3 text-base font-bold disabled:opacity-50 shadow-xl rounded-lg border-2 border-yellow-400"
                >
                  Verify Code
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setMode('input'); setCode(''); }}
                  className="px-4 py-3 text-base border-2 border-yellow-400/50 text-yellow-200 hover:bg-yellow-500/20 hover:text-white hover:border-yellow-400 rounded-lg font-semibold"
                >
                  Cancel
                </Button>
              </div>

              <Button
                type="button"
                variant="link"
                onClick={handleSendCode}
                className="w-full text-sm text-yellow-300 hover:text-yellow-200 h-auto p-0 transition-colors font-semibold"
              >
                Didn't receive the code? Resend
              </Button>
            </motion.div>
          )}

          {mode === 'verifying' && (
            <motion.div
              key="verifying"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center py-12 returning-customer-content"
            >
              <Loader2 className="h-10 w-10 animate-spin text-yellow-400 mr-3" />
              <span className="text-white text-base font-medium">Verifying your account...</span>
            </motion.div>
          )}

          {mode === 'authenticated' && (
            <motion.div
              key="authenticated"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4 returning-customer-content"
            >
              <div className="flex items-center justify-between bg-yellow-500/20 border-2 border-yellow-400/60 rounded-xl p-4 shadow-xl">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-yellow-400 flex-shrink-0" />
                  <div>
                    <p className="text-base font-bold text-white">
                      Welcome back, {customerData?.first_name || 'Valued Customer'}!
                    </p>
                    <p className="text-sm text-yellow-200">{email}</p>
                  </div>
                </div>
                <span className="text-xs bg-yellow-500/30 text-yellow-200 px-3 py-1.5 rounded-full border-2 border-yellow-400/60 font-bold whitespace-nowrap">
                  ✓ Verified
                </span>
              </div>

              {pastBookings.length > 0 ? (
                <div className="bg-blue-950/30 rounded-xl border-2 border-blue-400/30 p-4 space-y-3 shadow-lg">
                  <p className="text-sm font-bold text-blue-200 mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Your Recent Orders:
                  </p>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-2 scrollbar-thin">
                    {pastBookings.map((booking) => (
                      <div
                        key={booking.id}
                        className="flex items-center justify-between bg-blue-900/20 rounded-lg p-3 hover:bg-blue-800/30 transition-all group border border-blue-500/20 hover:border-blue-400/40 shadow-md"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-blue-400 flex-shrink-0" />
                            <span className="text-sm font-semibold text-white truncate">
                              {booking.plan?.name || 'Service'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-300">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDate(booking.drop_off_date)}
                            </span>
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3 w-3" />
                              ${Number(booking.total_price || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          onClick={() => handleReorder(booking)}
                          size="sm"
                          className="ml-3 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-gray-900 px-3 py-2 h-auto text-xs flex-shrink-0 font-bold shadow-md rounded-lg"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          Reorder
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-blue-500/10 border-2 border-blue-400/30 rounded-xl p-4 shadow-lg">
                  <p className="text-sm text-blue-200 text-center font-medium">
                    No previous orders found. Let's create your first booking!
                  </p>
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={handleNewOrder}
                className="w-full border-2 border-yellow-400/50 text-yellow-200 hover:bg-yellow-500/20 hover:text-white hover:border-yellow-400 py-3 text-base transition-all font-semibold rounded-lg shadow-lg"
              >
                Start a New Order
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};