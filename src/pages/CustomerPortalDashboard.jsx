
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Loader2, Lock, AlertTriangle, LogOut, Video, Calendar, Clock, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import QRCode from 'qrcode.react';
import { format } from 'date-fns';

export const CustomerPortalDashboard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [accessCode, setAccessCode] = useState(null);
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    validateSession();
  }, []);

  const validateSession = async () => {
    try {
      // Get session from localStorage
      const sessionData = localStorage.getItem('rental_portal_session');
      
      if (!sessionData) {
        throw new Error('No active session');
      }

      const parsedSession = JSON.parse(sessionData);

      // Check expiration
      if (new Date(parsedSession.expires_at) < new Date()) {
        localStorage.removeItem('rental_portal_session');
        throw new Error('Session expired');
      }

      setSession(parsedSession);

      // Fetch full booking details
      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', parsedSession.order_id)
        .single();

      if (bookingError) throw bookingError;

      setBooking(bookingData);

      // Fetch access code from rental_access_codes
      const { data: codeData, error: codeError } = await supabase
        .from('rental_access_codes')
        .select('*')
        .eq('order_id', parsedSession.order_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (codeError && codeError.code !== 'PGRST116') {
        console.error('[CustomerPortalDashboard] Access code error:', codeError);
      }

      setAccessCode(codeData);

    } catch (error) {
      console.error('[CustomerPortalDashboard] Session validation error:', error);
      toast({
        title: 'Session Invalid',
        description: 'Please log in again',
        variant: 'destructive'
      });
      navigate('/customer-portal/login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('rental_portal_session');
    toast({
      title: 'Logged Out',
      description: 'You have been logged out successfully'
    });
    navigate('/customer-portal/login');
  };

  const generateMagicLink = () => {
    if (!session) return '';
    const baseUrl = window.location.origin;
    const token = btoa(`${session.order_id}:${session.phone}:${new Date().toISOString().split('T')[0]}`);
    return `${baseUrl}/customer-portal/login?order_id=${session.order_id}&phone=${session.phone}&token=${token}`;
  };

  const isActiveRental = () => {
    if (!accessCode) return false;
    const now = new Date();
    const start = new Date(accessCode.start_time);
    const end = new Date(accessCode.end_time);
    return now >= start && now <= end;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 flex items-center justify-center">
        <Loader2 className="h-12 w-12 text-yellow-400 animate-spin" />
      </div>
    );
  }

  if (!session || !booking) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>My Rental Dashboard - U-Fill Dumpsters</title>
        <meta name="description" content="View your trailer rental details and access code" />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 py-8 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="flex justify-between items-center mb-8">
            <motion.h1
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-3xl font-bold text-white"
            >
              My Rental Dashboard
            </motion.h1>
            <Button
              onClick={handleLogout}
              variant="outline"
              className="text-white border-white/30 hover:bg-white/10"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>

          <div className="space-y-6">
            {/* Access Code Display - HERO CARD */}
            {accessCode && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className="bg-gradient-to-br from-yellow-400 to-orange-500 border-0 shadow-2xl">
                  <CardHeader className="text-center pb-4">
                    <div className="flex justify-center mb-4">
                      <div className="bg-white/20 backdrop-blur-sm p-4 rounded-full">
                        <Key className="h-12 w-12 text-white" />
                      </div>
                    </div>
                    <CardTitle className="text-3xl font-bold text-white">
                      Your Trailer Access Code
                    </CardTitle>
                    <CardDescription className="text-white/90 text-lg">
                      Use this PIN to unlock the trailer
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="text-center space-y-6">
                    {/* PIN Display */}
                    <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-8">
                      <p className="text-8xl font-black text-white tracking-widest mb-4 font-mono">
                        {accessCode.access_pin}
                      </p>
                      <p className="text-white/90 font-semibold">
                        {isActiveRental() ? '✓ ACTIVE NOW' : '⏱ Not Yet Active'}
                      </p>
                    </div>

                    {/* Validity Period Warning */}
                    <Alert className="bg-white/10 border-white/30 text-white">
                      <AlertTriangle className="h-5 w-5" />
                      <AlertDescription className="text-left">
                        <strong className="block mb-2">IMPORTANT:</strong>
                        This access code is valid only during your scheduled rental period from{' '}
                        <strong>{format(new Date(accessCode.start_time), 'MMM d, yyyy h:mm a')}</strong> to{' '}
                        <strong>{format(new Date(accessCode.end_time), 'MMM d, yyyy h:mm a')}</strong>.
                        The code will not work before or after these times. Please ensure you access the trailer within your rental window.
                      </AlertDescription>
                    </Alert>

                    {/* QR Codes */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                      <div className="bg-white p-4 rounded-lg">
                        <p className="text-sm font-bold text-gray-900 mb-2">Quick Access Link</p>
                        <QRCode value={generateMagicLink()} size={150} className="mx-auto" />
                        <p className="text-xs text-gray-600 mt-2">Scan to log in instantly</p>
                      </div>
                      <div className="bg-white p-4 rounded-lg">
                        <p className="text-sm font-bold text-gray-900 mb-2">Safety Video</p>
                        <QRCode 
                          value={`${window.location.origin}/customer-portal/resources`} 
                          size={150} 
                          className="mx-auto" 
                        />
                        <p className="text-xs text-gray-600 mt-2">How-To & Guides</p>
                      </div>
                    </div>

                    <Button
                      onClick={() => navigate('/customer-portal/resources')}
                      className="w-full bg-white text-orange-600 hover:bg-gray-100 font-bold py-6 text-lg"
                    >
                      <Video className="mr-2 h-5 w-5" />
                      View Safety Videos & Guides
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Rental Details Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card className="bg-white/10 backdrop-blur-lg border-white/20">
                <CardHeader>
                  <CardTitle className="text-white flex items-center">
                    <Calendar className="mr-2 h-5 w-5 text-yellow-400" />
                    Rental Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-white">
                    <div>
                      <p className="text-sm text-blue-200">Order ID</p>
                      <p className="font-bold text-lg">#{booking.id}</p>
                    </div>
                    <div>
                      <p className="text-sm text-blue-200">Status</p>
                      <p className="font-bold text-lg">{booking.status}</p>
                    </div>
                    <div>
                      <p className="text-sm text-blue-200">Pickup Date</p>
                      <p className="font-bold">{format(new Date(booking.drop_off_date), 'MMM d, yyyy')}</p>
                      {booking.drop_off_time_slot && (
                        <p className="text-sm text-blue-200">{booking.drop_off_time_slot}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-sm text-blue-200">Return Date</p>
                      <p className="font-bold">{format(new Date(booking.pickup_date), 'MMM d, yyyy')}</p>
                      {booking.pickup_time_slot && (
                        <p className="text-sm text-blue-200">{booking.pickup_time_slot}</p>
                      )}
                    </div>
                  </div>

                  {booking.notes && (
                    <div className="pt-4 border-t border-white/10">
                      <p className="text-sm text-blue-200 mb-1">Special Instructions</p>
                      <p className="text-white">{booking.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Additional Fees (if any) */}
            {booking.fees && Object.keys(booking.fees).length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <Card className="bg-orange-900/20 border-orange-500/30">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center">
                      <AlertTriangle className="mr-2 h-5 w-5 text-orange-400" />
                      Additional Fees
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(booking.fees).map(([key, value]) => (
                        <div key={key} className="flex justify-between text-white">
                          <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                          <span className="font-bold">${parseFloat(value).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default CustomerPortalDashboard;
