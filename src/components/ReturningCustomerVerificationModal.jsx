import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, Calendar, Package, AlertCircle, Plus, Gift } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';
import { mapCustomerToBookingData } from '@/utils/returningCustomerMapper';
import { markVerifiedEmailSession } from '@/utils/checkoutEmailVerification';

export const ReturningCustomerVerificationModal = ({
  isOpen,
  onClose,
  onReorderSelect,
  onCustomerVerified,
  mode = 'full',
  initialEmail = '',
}) => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [customerProfile, setCustomerProfile] = useState(null);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [step, setStep] = useState('email'); // email | code | bookings
  const [error, setError] = useState('');
  const isVerifyOnly = mode === 'verifyOnly';

  React.useEffect(() => {
    if (isOpen && initialEmail) {
      setEmail(initialEmail);
    }
  }, [isOpen, initialEmail]);

  const resetState = () => {
    setEmail('');
    setCode('');
    setBookings([]);
    setCustomerProfile(null);
    setPointsBalance(0);
    setStep('email');
    setError('');
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSendCode = async (e) => {
    e?.preventDefault();
    const normalizedEmail = email.toLowerCase().trim();

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
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
          pending_customer_id: null,
        },
      });

      if (fnError) {
        throw new Error(await parseEdgeFunctionError(fnError, data));
      }
      if (data?.error) throw new Error(data.error);

      setStep('code');
      toast({
        title: 'Code Sent',
        description: `We sent a verification code to ${normalizedEmail}.`,
      });
    } catch (err) {
      console.error('[ReturningCustomerVerificationModal] Send code error:', err);
      setError(err.message || 'Failed to send verification code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e?.preventDefault();

    const trimmedCode = code.trim();
    if (!trimmedCode || trimmedCode.length !== 6) {
      setError('Please enter the complete 6-digit verification code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const normalizedEmail = email.toLowerCase().trim();

      const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-email-code', {
        body: { email: normalizedEmail, code: trimmedCode },
      });

      if (verifyError) {
        throw new Error(await parseEdgeFunctionError(verifyError, verifyData));
      }
      if (!verifyData?.success) {
        throw new Error(verifyData?.error || 'Invalid verification code');
      }

      if (typeof window !== 'undefined') {
        markVerifiedEmailSession(normalizedEmail);
      }

      const data = verifyData.bookings || [];
      if (verifyData.customer) {
        setCustomerProfile(verifyData.customer);
      }

      if (isVerifyOnly) {
        const mapped = mapCustomerToBookingData(verifyData.customer, normalizedEmail);
        if (onCustomerVerified) {
          onCustomerVerified({
            ...mapped,
            returningCustomerVerified: true,
            usedReturningCustomerLink: true,
          });
        }
        toast({
          title: 'Verified',
          description: 'Your email is verified. You can continue with your booking.',
        });
        handleClose();
        return;
      }

      if (!data || data.length === 0) {
        setBookings([]);
      }

      const planIds = [...new Set((data || []).map((row) => row.plan_id).filter(Boolean))];
      let plansById = {};
      if (planIds.length > 0) {
        const { data: planRows, error: planError } = await supabase
          .from('plans')
          .select('id, name')
          .in('id', planIds);

        if (planError) {
          console.warn('[ReturningCustomerVerificationModal] Could not load plan names:', planError);
        } else {
          plansById = (planRows || []).reduce((acc, row) => {
            acc[row.id] = row;
            return acc;
          }, {});
        }
      }

      const enrichedBookings = (data || []).map((row) => ({
        ...row,
        plan: plansById[row.plan_id] || row.plan || null,
      }));

      try {
        const { data: rewardsData, error: rewardsError } = await supabase.functions.invoke('get-returning-customer-rewards', {
          body: { email: normalizedEmail },
        });

        if (rewardsError) {
          console.warn('[ReturningCustomerVerificationModal] Rewards lookup error:', rewardsError);
        } else if (rewardsData?.success) {
          setPointsBalance(Number(rewardsData.pointsBalance || 0));
          if (!verifyData.customer && rewardsData.customer) {
            setCustomerProfile(rewardsData.customer);
          }
        }
      } catch (rewardsErr) {
        console.warn('[ReturningCustomerVerificationModal] Rewards lookup exception:', rewardsErr);
      }

      setBookings(enrichedBookings);
      setStep('bookings');
    } catch (err) {
      console.error('[ReturningCustomerVerificationModal] Verify error:', err);
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReorder = (booking) => {
    if (onReorderSelect) {
      onReorderSelect(booking);
    }

    toast({
      title: 'Booking Loaded',
      description: 'Your previous booking details have been pre-filled. Please select new dates to continue.',
    });

    handleClose();
  };

  const handleBack = () => {
    if (step === 'bookings') {
      setBookings([]);
      setStep('code');
    } else if (step === 'code') {
      setStep('email');
      setCode('');
    }
    setError('');
  };

  const handleStartNewBooking = () => {
    const normalizedEmail = email.toLowerCase().trim();
    const mapped = mapCustomerToBookingData(customerProfile, normalizedEmail);
    if (onCustomerVerified) {
      onCustomerVerified({
        ...mapped,
        returningCustomerVerified: true,
        usedReturningCustomerLink: true,
        loyalty: {
          pointsBalance,
        },
      });
    }

    toast({
      title: 'Welcome Back',
      description: 'Your contact details were pre-filled for faster checkout.',
    });

    handleClose();
  };

  const formatBookingDate = (dateString) => {
    try {
      return format(new Date(dateString), 'MMMM d, yyyy');
    } catch {
      return dateString;
    }
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'text-green-400 bg-green-900/20 border-green-500/30';
      case 'delivered':
      case 'confirmed':
        return 'text-blue-400 bg-blue-900/20 border-blue-500/30';
      case 'cancelled':
        return 'text-red-400 bg-red-900/20 border-red-500/30';
      default:
        return 'text-gray-400 bg-gray-900/20 border-gray-500/30';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {step === 'email' && 'Welcome Back!'}
            {step === 'code' && 'Verify Your Email'}
            {step === 'bookings' && 'Your Previous Bookings'}
          </DialogTitle>
          <DialogDescription>
            {step === 'email' &&
              (isVerifyOnly
                ? 'Verify your email to confirm your returning customer account for this booking.'
                : 'Enter your email to receive a verification code and access your booking history.')}
            {step === 'code' && `Enter the code we sent to ${email}.`}
            {step === 'bookings' && 'Reorder a past booking or start a new booking with your profile pre-filled.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'email' && (
          <form onSubmit={handleSendCode} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="returning-email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-300" />
                <Input
                  id="returning-email"
                  type="email"
                  placeholder="your.email@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            {error && <ErrorBanner message={error} />}

            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" disabled={loading || !email} className="flex-1 bg-blue-600 hover:bg-blue-700">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send Verification Code'
                )}
              </Button>
            </div>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyCode} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="verification-code">Verification Code</Label>
              <Input
                id="verification-code"
                type="text"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ''));
                  setError('');
                }}
                className="text-center text-2xl tracking-[0.5em] font-mono"
                autoFocus
              />
            </div>

            {error && <ErrorBanner message={error} />}

            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" onClick={handleBack} className="flex-1">
                Back
              </Button>
              <Button
                type="submit"
                disabled={loading || code.trim().length !== 6}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : isVerifyOnly ? (
                  'Verify Email'
                ) : (
                  'Verify & View Bookings'
                )}
              </Button>
            </div>

            <Button
              type="button"
              variant="link"
              onClick={handleSendCode}
              disabled={loading}
              className="w-full text-sm"
            >
              Resend code
            </Button>
          </form>
        )}

        {step === 'bookings' && (
          <div className="space-y-4 mt-4">
            {pointsBalance > 0 && (
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-3 flex items-start gap-2">
                <Gift className="h-5 w-5 text-purple-300 mt-0.5" />
                <p className="text-sm text-purple-100">
                  You have <strong>{pointsBalance} loyalty points</strong> available for this booking.
                </p>
              </div>
            )}
            <div className="grid gap-3">
              {bookings.length === 0 && (
                <Card className="bg-white/5 border-white/10">
                  <CardContent className="py-4">
                    <p className="text-sm text-muted-foreground">
                      We could not find previous bookings for this email yet, but you can still start a new booking with your saved profile.
                    </p>
                  </CardContent>
                </Card>
              )}
              {bookings.map((booking) => (
                <Card key={booking.id} className="bg-white/5 border-white/10 hover:bg-white/10 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">
                          {booking.plan?.name || 'Service'}
                        </CardTitle>
                        <CardDescription>Order #{booking.id}</CardDescription>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(booking.status)}`}>
                        {booking.status}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span>
                        {booking.drop_off_date
                          ? formatBookingDate(booking.drop_off_date)
                          : formatBookingDate(booking.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Package className="h-4 w-4" />
                      <span>Total: ${Number(booking.total_price || 0).toFixed(2)}</span>
                    </div>
                    <Button
                      onClick={() => handleReorder(booking)}
                      className="w-full mt-3 bg-green-600 hover:bg-green-700"
                      size="sm"
                    >
                      Reorder This Service
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                onClick={handleStartNewBooking}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="mr-2 h-4 w-4" />
                Start New Booking
              </Button>
              <Button variant="outline" onClick={handleBack} className="flex-1">
                Back
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const ErrorBanner = ({ message }) => (
  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
    <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
    <p className="text-sm text-red-200">{message}</p>
  </div>
);
