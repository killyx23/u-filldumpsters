import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Loader2, LogOut, Home, Key, Calendar, Clock, Info, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { format, parseISO, isPast } from 'date-fns';

const CustomerPortalDashboard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(null);
  const [accessCode, setAccessCode] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    checkSessionAndFetchData();
  }, []);

  const checkSessionAndFetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check for session in localStorage
      const sessionStr = localStorage.getItem('rental_portal_session');
      const orderId = localStorage.getItem('customerPortalOrderId');
      const urlOrderId = searchParams.get('order_id');

      // Determine which order ID to use
      let targetOrderId = null;
      if (urlOrderId) {
        targetOrderId = parseInt(urlOrderId);
      } else if (orderId) {
        targetOrderId = parseInt(orderId);
      } else if (sessionStr) {
        try {
          const session = JSON.parse(sessionStr);
          targetOrderId = session.order_id;
        } catch (e) {
          console.error('[Dashboard] Failed to parse session:', e);
        }
      }

      // If no order ID found, redirect to login
      if (!targetOrderId) {
        toast({
          title: 'Session Expired',
          description: 'Your session has expired. Please log in again.',
          variant: 'destructive'
        });
        navigate('/customer-portal/login');
        return;
      }

      // Fetch booking data
      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', targetOrderId)
        .single();

      if (bookingError || !bookingData) {
        throw new Error('Booking not found. Please check your Order ID.');
      }

      // Check if this is a Dump Loader Trailer Rental
      const isDumpLoaderRental = 
        bookingData.plan?.name?.toLowerCase().includes('dump loader') ||
        bookingData.plan?.name?.toLowerCase().includes('trailer') ||
        parseInt(bookingData.plan?.id) === 2;

      if (!isDumpLoaderRental) {
        setError('This service does not require an access code.');
        setBooking(bookingData);
        setLoading(false);
        return;
      }

      setBooking(bookingData);

      // Fetch access code
      const { data: accessCodeData, error: accessCodeError } = await supabase
        .from('rental_access_codes')
        .select('*')
        .eq('order_id', targetOrderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (accessCodeError && accessCodeError.code !== 'PGRST116') {
        console.error('[Dashboard] Access code fetch error:', accessCodeError);
      }

      setAccessCode(accessCodeData || null);

    } catch (err) {
      console.error('[Dashboard] Error:', err);
      setError(err.message);
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('rental_portal_session');
    localStorage.removeItem('customerPortalOrderId');
    localStorage.removeItem('customerPortalPhone');
    toast({
      title: 'Logged Out',
      description: 'You have been logged out successfully.'
    });
    navigate('/');
  };

  const formatDateTime = (dateStr, timeSlot) => {
    if (!dateStr) return 'N/A';
    try {
      const date = parseISO(dateStr);
      const dateFormatted = format(date, 'MMM dd, yyyy');
      return `${dateFormatted}${timeSlot ? ` at ${timeSlot}` : ''}`;
    } catch (e) {
      return dateStr;
    }
  };

  const isRentalExpired = () => {
    if (!accessCode?.end_time) return false;
    try {
      return isPast(parseISO(accessCode.end_time));
    } catch {
      return false;
    }
  };

  if (loading) {
    return (
      <>
        <Helmet>
          <title>Loading - Customer Portal</title>
        </Helmet>
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 flex items-center justify-center p-4">
          <div className="text-center space-y-4">
            <Loader2 className="h-12 w-12 text-yellow-400 animate-spin mx-auto" />
            <p className="text-white text-lg font-medium">Loading your rental information...</p>
          </div>
        </div>
      </>
    );
  }

  if (error && !booking) {
    return (
      <>
        <Helmet>
          <title>Error - Customer Portal</title>
        </Helmet>
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 p-4">
          <div className="container mx-auto max-w-2xl py-8">
            <Card className="bg-white/10 backdrop-blur-lg border-white/20">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <AlertCircle className="h-6 w-6 text-red-400" />
                  Error
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-white">{error}</p>
                <div className="flex gap-2">
                  <Button onClick={() => navigate('/customer-portal/login')} variant="outline">
                    Back to Login
                  </Button>
                  <Button onClick={() => navigate('/')} className="bg-yellow-400 hover:bg-yellow-500 text-blue-900">
                    Go Home
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>Your Rental Access - Customer Portal</title>
        <meta name="description" content="View your trailer rental access code and booking details" />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 p-4">
        <div className="container mx-auto max-w-4xl py-8">
          {/* Header Navigation */}
          <div className="flex justify-between items-center mb-8">
            <Link 
              to="/" 
              className="flex items-center gap-2 text-blue-200 hover:text-white transition-colors"
            >
              <Home className="h-5 w-5" />
              <span className="font-medium">Back to Home</span>
            </Link>
            <Button 
              onClick={handleLogout}
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>

          {/* Page Title */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8"
          >
            <h1 className="text-4xl font-bold text-white mb-2">Your Rental Access</h1>
            <p className="text-blue-200">Access code for your trailer rental</p>
          </motion.div>

          {/* Rental Details */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="bg-white/10 backdrop-blur-lg border-white/20 mb-6">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-yellow-400" />
                  Rental Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-white">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-blue-200">Customer Name</p>
                    <p className="font-medium text-lg">
                      {booking?.first_name && booking?.last_name 
                        ? `${booking.first_name} ${booking.last_name}`
                        : booking?.name || 'N/A'
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-blue-200">Order ID</p>
                    <p className="font-medium text-lg">#{booking?.id}</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-blue-200">Service Type</p>
                  <p className="font-medium text-lg">Dump Loader Trailer Rental</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-blue-200 flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      Pickup Date & Time
                    </p>
                    <p className="font-medium">
                      {formatDateTime(booking?.drop_off_date, booking?.drop_off_time_slot)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-blue-200 flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      Return Date & Time
                    </p>
                    <p className="font-medium">
                      {formatDateTime(booking?.pickup_date, booking?.pickup_time_slot)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* ACCESS PIN DISPLAY - MAIN FEATURE */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            {isRentalExpired() ? (
              <Card className="bg-red-900/30 backdrop-blur-lg border-red-500/50 mb-6">
                <CardContent className="p-8 text-center">
                  <AlertCircle className="h-16 w-16 text-red-400 mx-auto mb-4" />
                  <h2 className="text-2xl font-bold text-white mb-2">Rental Period Ended</h2>
                  <p className="text-red-200 text-lg">
                    This rental period has ended. Your access code is no longer valid.
                  </p>
                </CardContent>
              </Card>
            ) : accessCode?.access_pin ? (
              <>
                <Card className="bg-slate-900 backdrop-blur-lg border-yellow-400/50 shadow-2xl mb-6">
                  <CardContent className="p-8 md:p-12">
                    <div className="text-center space-y-6">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-yellow-400 font-semibold mb-2">
                          YOUR ACCESS PIN
                        </p>
                        <div className="bg-slate-950 rounded-lg p-8 inline-block">
                          <p className="text-6xl md:text-7xl lg:text-8xl font-bold font-mono text-white tracking-wider">
                            {accessCode.access_pin}
                          </p>
                        </div>
                        <p className="text-sm text-gray-400 mt-3">
                          Enter this code at the lock
                        </p>
                      </div>

                      {accessCode.start_time && accessCode.end_time && (
                        <div className="border-t border-white/10 pt-6">
                          <p className="text-white font-medium">
                            Valid from:{' '}
                            <span className="text-yellow-400">
                              {formatDateTime(accessCode.start_time, null)}
                            </span>
                            {' '}to{' '}
                            <span className="text-yellow-400">
                              {formatDateTime(accessCode.end_time, null)}
                            </span>
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Validity Warning */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <Card className="bg-blue-50/90 backdrop-blur-sm border-blue-200">
                    <CardContent className="p-6">
                      <div className="flex gap-4">
                        <div className="flex-shrink-0">
                          <div className="bg-blue-100 rounded-full p-2">
                            <Info className="h-6 w-6 text-blue-600" />
                          </div>
                        </div>
                        <div>
                          <h3 className="font-semibold text-blue-900 mb-2 text-lg">Important Information</h3>
                          <p className="text-blue-800 text-base leading-relaxed">
                            ⏰ This access code is valid <strong>ONLY</strong> during your scheduled rental period from{' '}
                            <strong>{formatDateTime(accessCode.start_time, null)}</strong> to{' '}
                            <strong>{formatDateTime(accessCode.end_time, null)}</strong>. 
                            The code will not work before or after these times. Please ensure you access the trailer within your rental window.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              </>
            ) : (
              <Card className="bg-yellow-50/90 backdrop-blur-sm border-yellow-200">
                <CardContent className="p-8 text-center">
                  <Key className="h-16 w-16 text-yellow-600 mx-auto mb-4" />
                  <h2 className="text-2xl font-bold text-yellow-900 mb-2">Access Code Generating</h2>
                  <p className="text-yellow-800 text-lg mb-6">
                    Your access code is being generated. Please refresh this page in a moment.
                  </p>
                  <Button 
                    onClick={checkSessionAndFetchData}
                    className="bg-yellow-500 hover:bg-yellow-600 text-white"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </CardContent>
              </Card>
            )}
          </motion.div>

          {/* Help Section */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-center mt-8"
          >
            <p className="text-blue-200">
              Need help?{' '}
              <Link to="/contact" className="text-yellow-400 hover:underline font-medium">
                Contact Support
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
    </>
  );
};

export default CustomerPortalDashboard;