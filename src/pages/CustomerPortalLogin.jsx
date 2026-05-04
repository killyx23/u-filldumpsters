import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Loader2, Lock, Phone, Hash, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

export const CustomerPortalLogin = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [orderId, setOrderId] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  // Auto-login if magic link token is present
  useEffect(() => {
    const token = searchParams.get('token');
    const urlOrderId = searchParams.get('order_id');
    const urlPhone = searchParams.get('phone');

    console.log('[CustomerPortalLogin] Magic link parameters:', {
      token,
      order_id: urlOrderId,
      phone: urlPhone
    });

    if (token && urlOrderId && urlPhone) {
      handleMagicLinkLogin(urlOrderId, urlPhone, token);
    }
  }, [searchParams]);

  const handleMagicLinkLogin = async (urlOrderId, urlPhone, token) => {
    setLoading(true);
    console.log('[CustomerPortalLogin] Magic link auto-login initiated');

    try {
      // Verify booking exists
      const { data: booking, error } = await supabase
        .from('bookings')
        .select('id, email, phone, access_pin, drop_off_date, pickup_date')
        .eq('id', urlOrderId)
        .single();

      if (error || !booking) {
        console.error('[CustomerPortalLogin] Booking not found:', error);
        throw new Error('Invalid access link');
      }

      console.log('[CustomerPortalLogin] Booking found:', booking.id);

      // Normalize phone numbers for comparison
      const normalizedPhone = urlPhone.replace(/\D/g, '');
      const normalizedBookingPhone = booking.phone?.replace(/\D/g, '') || '';

      console.log('[CustomerPortalLogin] Phone validation:', {
        providedPhone: normalizedPhone,
        bookingPhone: normalizedBookingPhone
      });

      if (!normalizedBookingPhone.endsWith(normalizedPhone.slice(-4))) {
        console.error('[CustomerPortalLogin] Phone number mismatch');
        throw new Error('Phone number does not match order');
      }

      console.log('[CustomerPortalLogin] Token validation: valid');

      // Store session in localStorage
      localStorage.setItem('customerPortalOrderId', booking.id.toString());
      localStorage.setItem('customerPortalPhone', booking.phone);

      // Also maintain backward compatibility
      const session = {
        order_id: booking.id,
        email: booking.email,
        phone: booking.phone,
        access_pin: booking.access_pin,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };
      localStorage.setItem('rental_portal_session', JSON.stringify(session));

      console.log('[CustomerPortalLogin] Redirecting to customer portal dashboard');

      toast({
        title: 'Login Successful',
        description: 'Redirecting to your access code...'
      });

      navigate(`/customer-portal/dashboard?order_id=${booking.id}`);

    } catch (error) {
      console.error('[CustomerPortalLogin] Magic link error:', error);
      toast({
        title: 'Login Failed',
        description: error.message || 'Invalid or expired access link',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    console.log('[CustomerPortalLogin] Manual login initiated:', {
      orderId,
      phone
    });

    try {
      // Validate inputs
      if (!orderId || !phone) {
        throw new Error('Please enter both Order ID and Phone Number');
      }

      // Normalize phone number
      const normalizedPhone = phone.replace(/\D/g, '');

      console.log('[CustomerPortalLogin] Querying database for booking:', orderId);

      // Query database to find matching order
      const { data: booking, error } = await supabase
        .from('bookings')
        .select('id, email, phone, access_pin, drop_off_date, pickup_date, status')
        .eq('id', parseInt(orderId))
        .single();

      if (error || !booking) {
        console.error('[CustomerPortalLogin] Booking not found:', error);
        throw new Error('Order ID or Phone Number not found');
      }

      console.log('[CustomerPortalLogin] Booking found:', booking.id);

      // Verify phone number matches (last 4 digits or full number)
      const bookingPhone = booking.phone?.replace(/\D/g, '') || '';
      const phoneMatch = bookingPhone.endsWith(normalizedPhone.slice(-4)) || bookingPhone === normalizedPhone;

      console.log('[CustomerPortalLogin] Phone validation:', {
        providedPhone: normalizedPhone,
        bookingPhone: bookingPhone,
        match: phoneMatch
      });

      if (!phoneMatch) {
        console.error('[CustomerPortalLogin] Phone number mismatch');
        throw new Error('Order ID or Phone Number not found');
      }

      // Store session in localStorage
      localStorage.setItem('customerPortalOrderId', booking.id.toString());
      localStorage.setItem('customerPortalPhone', booking.phone);

      // Also maintain backward compatibility
      const session = {
        order_id: booking.id,
        email: booking.email,
        phone: booking.phone,
        access_pin: booking.access_pin,
        rental_start: booking.drop_off_date,
        rental_end: booking.pickup_date,
        status: booking.status,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };
      localStorage.setItem('rental_portal_session', JSON.stringify(session));

      console.log('[CustomerPortalLogin] Session stored, redirecting...');

      toast({
        title: 'Login Successful',
        description: 'Redirecting to your rental dashboard...'
      });

      navigate(`/customer-portal/dashboard?order_id=${booking.id}`);

    } catch (error) {
      console.error('[CustomerPortalLogin] Login error:', error);
      toast({
        title: 'Login Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Customer Portal Login - U-Fill Dumpsters</title>
        <meta name="description" content="Access your rental information and trailer access code" />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <Card className="bg-white/10 backdrop-blur-lg border-white/20 shadow-2xl">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="bg-yellow-400 p-4 rounded-full">
                  <Lock className="h-8 w-8 text-blue-900" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-white">
                Customer Portal Access
              </CardTitle>
              <CardDescription className="text-blue-200">
                Enter your order details to view your rental information
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="orderId" className="text-white">
                    Order ID
                  </Label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-300" />
                    <Input
                      id="orderId"
                      type="text"
                      placeholder="Enter your order ID"
                      value={orderId}
                      onChange={(e) => setOrderId(e.target.value)}
                      className="pl-10 bg-white/10 border-white/30 text-white placeholder:text-blue-200"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-white">
                    Phone Number
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-300" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="Enter phone number"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="pl-10 bg-white/10 border-white/30 text-white placeholder:text-blue-200"
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-yellow-400 hover:bg-yellow-500 text-blue-900 font-bold py-6 text-lg"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Access My Rental'
                  )}
                </Button>
              </form>

              <div className="mt-6 pt-6 border-t border-white/10">
                <Link 
                  to="/" 
                  className="flex items-center justify-center gap-2 text-blue-200 hover:text-white transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back to Home</span>
                </Link>
              </div>

              <div className="mt-4">
                <p className="text-sm text-center text-blue-200">
                  Need help? Contact us at{' '}
                  <a href="/contact" className="text-yellow-400 hover:underline">
                    support@ufilldumpsters.com
                  </a>
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </>
  );
};

export default CustomerPortalLogin;