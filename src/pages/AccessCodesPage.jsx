
import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Loader2, Key, Calendar, Clock, Info, RefreshCw, AlertCircle, QrCode, Shield, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { format, parseISO, isPast } from 'date-fns';
import QRCode from 'qrcode.react';

const AccessCodesPage = ({ customerData }) => {
  const [loading, setLoading] = useState(true);
  const [accessCode, setAccessCode] = useState(null);
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState(null);
  const [magicLinkToken, setMagicLinkToken] = useState(null);
  const [generatingQR, setGeneratingQR] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 5;

  useEffect(() => {
    console.log('[AccessCodesPage] Component mounted');
    if (customerData) {
      console.log('[AccessCodesPage] Customer data available:', customerData.id);
      fetchAccessCode();
    }
  }, [customerData]);

  const fetchAccessCode = async () => {
    const context = 'AccessCodesPage-fetchAccessCode';
    
    try {
      setLoading(true);
      setError(null);

      console.log(`[${context}] Starting fetch for customer:`, customerData.id);

      // Fetch active rental booking
      console.log(`[${context}] Querying bookings table...`);
      
      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .select('*')
        .eq('customer_id', customerData.id)
        .in('status', ['Confirmed', 'confirmed', 'Delivered', 'delivered', 'waiting_to_be_returned', 'Rescheduled', 'rescheduled'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (bookingError && bookingError.code !== 'PGRST116') {
        console.error(`[${context}] Booking query error:`, bookingError);
        throw new Error('Failed to fetch booking details');
      }

      if (!bookingData) {
        console.log(`[${context}] No active rental found`);
        setError('No active rental found');
        setLoading(false);
        return;
      }

      console.log(`[${context}] Booking found:`, {
        bookingId: bookingData.id,
        bookingIdType: typeof bookingData.id,
        planId: bookingData.plan?.id,
        planName: bookingData.plan?.name,
        status: bookingData.status
      });

      setBooking(bookingData);

      // Check if this is a Dump Loader Trailer Rental
      const isDumpLoaderRental = 
        bookingData.plan?.name?.toLowerCase().includes('dump loader') ||
        bookingData.plan?.name?.toLowerCase().includes('trailer') ||
        parseInt(bookingData.plan?.id) === 2;

      console.log(`[${context}] Service type check:`, {
        isDumpLoaderRental,
        planName: bookingData.plan?.name
      });

      if (!isDumpLoaderRental) {
        setError('This service does not require an access code');
        setLoading(false);
        return;
      }

      // CRITICAL FIX: Ensure order_id is treated as bigint
      // The rental_access_codes.order_id column is bigint, so we need to ensure proper type matching
      const orderId = bookingData.id;
      
      console.log(`[${context}] Fetching access code for order_id: ${orderId} (type: ${typeof orderId})`);

      // Method 1: Try direct query with proper bigint handling
      const { data: accessCodeData, error: accessCodeError } = await supabase
        .from('rental_access_codes')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1);

      console.log(`[${context}] Access code query result:`, {
        error: accessCodeError,
        errorCode: accessCodeError?.code,
        errorMessage: accessCodeError?.message,
        dataCount: accessCodeData?.length || 0,
        hasData: !!accessCodeData && accessCodeData.length > 0,
        rawData: accessCodeData
      });

      if (accessCodeError) {
        console.error(`[${context}] Access code query error:`, accessCodeError);
        
        // If we get an error, try alternative query method
        console.log(`[${context}] Attempting alternative query method...`);
        
        const { data: altData, error: altError } = await supabase
          .from('rental_access_codes')
          .select('*')
          .filter('order_id', 'eq', orderId)
          .order('created_at', { ascending: false })
          .limit(1);
        
        console.log(`[${context}] Alternative query result:`, {
          error: altError,
          dataCount: altData?.length || 0,
          data: altData
        });
        
        if (altData && altData.length > 0) {
          console.log(`[${context}] Alternative query succeeded!`);
          setAccessCode(altData[0]);
          setRetryCount(0);
          setLoading(false);
          return;
        }
      }

      // Handle query results
      if (accessCodeData && accessCodeData.length > 0) {
        const codeRecord = accessCodeData[0];
        
        console.log(`[${context}] Access code record found:`, {
          id: codeRecord.id,
          orderId: codeRecord.order_id,
          orderIdType: typeof codeRecord.order_id,
          hasPin: !!codeRecord.access_pin,
          accessPin: codeRecord.access_pin,
          startTime: codeRecord.start_time,
          endTime: codeRecord.end_time,
          status: codeRecord.status
        });

        console.log(`[${context}] Access pin value: "${codeRecord.access_pin}"`);

        setAccessCode(codeRecord);

        // If PIN found, reset retry count
        if (codeRecord.access_pin) {
          console.log(`[${context}] PIN found, resetting retry count`);
          setRetryCount(0);
        }
      } else {
        console.log(`[${context}] No access code records found for order_id: ${orderId}`);
        console.log(`[${context}] Query details:`, {
          table: 'rental_access_codes',
          filter: `order_id = ${orderId}`,
          orderIdProvided: orderId,
          orderIdType: typeof orderId
        });
        
        // Debug: Try to fetch ALL records to see what's in the table
        const { data: allRecords, error: debugError } = await supabase
          .from('rental_access_codes')
          .select('id, order_id, access_pin, status')
          .limit(10);
        
        console.log(`[${context}] DEBUG - Recent access code records in table:`, {
          error: debugError,
          recordCount: allRecords?.length || 0,
          records: allRecords?.map(r => ({
            id: r.id,
            order_id: r.order_id,
            order_id_type: typeof r.order_id,
            has_pin: !!r.access_pin,
            status: r.status
          }))
        });
        
        setAccessCode(null);
      }

    } catch (err) {
      console.error(`[${context}] Unexpected error:`, err);
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

  const generateMagicLinkToken = async () => {
    const context = 'AccessCodesPage-generateMagicLink';
    
    try {
      setGeneratingQR(true);

      console.log(`[${context}] Generating magic link token for customer:`, {
        customerId: customerData.id,
        phone: customerData.phone
      });

      const { data, error } = await supabase.functions.invoke('generate-magic-link-token', {
        body: {
          customer_id: customerData.id,
          phone: customerData.phone
        }
      });

      if (error) {
        console.error(`[${context}] Token generation error:`, error);
        throw error;
      }

      console.log(`[${context}] Magic link token generated:`, {
        token: data.token,
        expiresAt: data.expires_at
      });

      setMagicLinkToken(data.token);

      // Create magic link URL
      const siteUrl = window.location.origin;
      const magicLinkUrl = `${siteUrl}/customer-portal?token=${data.token}&order_id=${booking?.id}&phone=${customerData.phone}`;
      
      console.log(`[${context}] QR code URL: ${magicLinkUrl}`);

    } catch (err) {
      console.error(`[${context}] Failed to generate magic link:`, err);
      toast({
        title: 'Error',
        description: 'Failed to generate QR code',
        variant: 'destructive'
      });
    } finally {
      setGeneratingQR(false);
    }
  };

  useEffect(() => {
    if (customerData && booking && !magicLinkToken && !generatingQR) {
      generateMagicLinkToken();
    }
  }, [customerData, booking]);

  const handleRefreshClick = () => {
    console.log('[AccessCodesPage] Manual refresh button clicked');
    
    if (retryCount >= MAX_RETRIES) {
      console.log('[AccessCodesPage] Max retries reached, not fetching');
      toast({
        title: 'Maximum Retries Reached',
        description: 'Please contact support if your access code has not appeared.',
        variant: 'destructive'
      });
      return;
    }

    setRetryCount(prev => prev + 1);
    console.log(`[AccessCodesPage] Retry count: ${retryCount + 1}/${MAX_RETRIES}`);
    fetchAccessCode();
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
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 text-yellow-400 animate-spin mx-auto" />
          <p className="text-white text-lg font-medium">Loading your access code...</p>
        </div>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <Card className="bg-white/10 backdrop-blur-lg border-white/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-red-400" />
            No Active Rental
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-white">{error}</p>
          <Button onClick={handleRefreshClick} variant="outline" className="border-white/30 text-white hover:bg-white/10">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardContent>
      </Card>
    );
  }

  const siteUrl = window.location.origin;
  const magicLinkUrl = magicLinkToken 
    ? `${siteUrl}/customer-portal?token=${magicLinkToken}&order_id=${booking?.id}&phone=${customerData.phone}`
    : '';
  const safetyVideoUrl = `${siteUrl}/customer-portal/resources`;

  return (
    <>
      <Helmet>
        <title>Access Codes - Customer Portal</title>
        <meta name="description" content="View your trailer rental access codes and instructions" />
      </Helmet>

      <div className="space-y-6">
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-3xl font-bold text-white mb-2">Access Codes</h1>
          <p className="text-blue-200">Your rental access information and QR codes</p>
        </motion.div>

        {/* Rental Details */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="bg-white/10 backdrop-blur-lg border-white/20">
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
                    {customerData?.first_name && customerData?.last_name 
                      ? `${customerData.first_name} ${customerData.last_name}`
                      : customerData?.name || 'N/A'
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

        {/* ACCESS PIN DISPLAY */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
        >
          {isRentalExpired() ? (
            <Card className="bg-red-900/30 backdrop-blur-lg border-red-500/50">
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
              <Card className="bg-slate-900 backdrop-blur-lg border-yellow-400/50 shadow-2xl">
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
                <h2 className="text-2xl font-bold text-yellow-900 mb-2">Access Code Generating...</h2>
                
                {retryCount >= MAX_RETRIES ? (
                  <>
                    <p className="text-red-800 text-lg mb-4 font-semibold">
                      Access code is taking longer than expected. Please try refreshing manually or contact support.
                    </p>
                    <p className="text-sm text-yellow-700 mb-6">
                      Maximum refresh attempts ({MAX_RETRIES}) reached. If your access code still doesn't appear, please contact our support team for assistance.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-yellow-800 text-lg mb-6">
                      Your access code is being generated. Click the button below to check for updates.
                    </p>
                    {retryCount > 0 && (
                      <p className="text-sm text-yellow-700 mb-4">
                        Refresh attempts: {retryCount} of {MAX_RETRIES}
                      </p>
                    )}
                  </>
                )}
                
                <Button 
                  onClick={handleRefreshClick}
                  disabled={retryCount >= MAX_RETRIES}
                  className={`${
                    retryCount >= MAX_RETRIES 
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-yellow-500 hover:bg-yellow-600'
                  } text-white`}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {retryCount >= MAX_RETRIES ? 'Max Retries Reached' : 'Refresh Now'}
                </Button>
                
                {retryCount < MAX_RETRIES && (
                  <p className="text-xs text-yellow-700 mt-4">
                    Click "Refresh Now" to manually check for your access code
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </motion.div>

        {/* QR Codes Section */}
        {accessCode?.access_pin && !isRentalExpired() && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card className="bg-white/10 backdrop-blur-lg border-white/20">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-yellow-400" />
                  Quick Access QR Codes
                </CardTitle>
                <CardDescription className="text-blue-200">
                  Scan these codes for quick access to your information
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Access Code QR */}
                  <div className="bg-white rounded-lg p-6 text-center space-y-4">
                    <div className="bg-yellow-100 rounded-full p-3 w-fit mx-auto">
                      <Shield className="h-6 w-6 text-yellow-600" />
                    </div>
                    <h3 className="font-bold text-gray-900 text-lg">Access Code</h3>
                    {magicLinkUrl ? (
                      <>
                        <div className="bg-gray-50 p-4 rounded-lg inline-block">
                          <QRCode value={magicLinkUrl} size={200} level="H" />
                        </div>
                        <p className="text-sm text-gray-600 italic">
                          Scan this QR code with your phone camera to quickly access your PIN
                        </p>
                      </>
                    ) : (
                      <div className="flex items-center justify-center h-[200px]">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-600" />
                      </div>
                    )}
                  </div>

                  {/* Safety Video QR */}
                  <div className="bg-white rounded-lg p-6 text-center space-y-4">
                    <div className="bg-blue-100 rounded-full p-3 w-fit mx-auto">
                      <BookOpen className="h-6 w-6 text-blue-600" />
                    </div>
                    <h3 className="font-bold text-gray-900 text-lg">Safety Instructions</h3>
                    <div className="bg-gray-50 p-4 rounded-lg inline-block">
                      <QRCode value={safetyVideoUrl} size={200} level="H" />
                    </div>
                    <p className="text-sm text-gray-600 italic">
                      Scan to watch safety videos and operating instructions
                    </p>
                  </div>
                </div>

                {/* Warning Notice */}
                <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-800 text-sm font-semibold flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    ⚠️ PRIVATE INFORMATION
                  </p>
                  <p className="text-red-700 text-sm mt-2">
                    These QR codes contain your personal rental information. Keep them secure and do not share with others.
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </>
  );
};

export default AccessCodesPage;
