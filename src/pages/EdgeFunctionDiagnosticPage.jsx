import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Play, AlertTriangle, CheckCircle, XCircle, Terminal, Database, Key, Globe, FileJson, Zap } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

const EdgeFunctionDiagnosticPage = () => {
  const [testPayload, setTestPayload] = useState({
    booking_id: 1,
    order_id: 1199,
    customer_email: 'test@example.com',
    customer_phone: '3854828842',
    start_time: '2026-04-27T00:00:00Z',
    end_time: '2026-04-28T00:00:00Z'
  });

  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [databaseCheckResult, setDatabaseCheckResult] = useState(null);
  const [checkingDatabase, setCheckingDatabase] = useState(false);

  // Test the Edge Function directly
  const handleTestEdgeFunction = async () => {
    setLoading(true);
    setTestResult(null);

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [EdgeFunctionDiagnostic] ========== TESTING EDGE FUNCTION ==========`);
    console.log(`[${timestamp}] [EdgeFunctionDiagnostic] Test Payload:`, testPayload);

    try {
      const startTime = Date.now();

      const { data, error } = await supabase.functions.invoke('generate-igloohome-pin', {
        body: testPayload
      });

      const duration = Date.now() - startTime;

      console.log(`[${timestamp}] [EdgeFunctionDiagnostic] Edge Function Response (${duration}ms):`, {
        data,
        error
      });

      if (error) {
        console.error(`[${timestamp}] [EdgeFunctionDiagnostic] ❌ Edge Function Error:`, {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          status: error.status,
          fullError: JSON.stringify(error, null, 2)
        });

        setTestResult({
          success: false,
          error: error.message,
          errorDetails: error,
          duration,
          timestamp,
          step: 'edge_function_invocation'
        });

        toast({
          title: 'Edge Function Test Failed',
          description: error.message,
          variant: 'destructive'
        });
      } else {
        console.log(`[${timestamp}] [EdgeFunctionDiagnostic] ✅ Edge Function Success:`, data);

        setTestResult({
          success: data?.success || false,
          data: data,
          duration,
          timestamp,
          step: data?.step || 'completed'
        });

        if (data?.success) {
          toast({
            title: 'Edge Function Test Successful',
            description: `Access code: ${data.access_code}`,
          });
        } else {
          toast({
            title: 'Edge Function Returned Error',
            description: data?.error || 'Unknown error',
            variant: 'destructive'
          });
        }
      }
    } catch (err) {
      const errorTimestamp = new Date().toISOString();
      console.error(`[${errorTimestamp}] [EdgeFunctionDiagnostic] ❌ Exception:`, {
        error: err,
        message: err.message,
        stack: err.stack,
        name: err.name
      });

      setTestResult({
        success: false,
        error: err.message,
        errorDetails: err,
        timestamp: errorTimestamp,
        step: 'exception'
      });

      toast({
        title: 'Test Exception',
        description: err.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  // Check database permissions and structure
  const handleCheckDatabase = async () => {
    setCheckingDatabase(true);
    setDatabaseCheckResult(null);

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [EdgeFunctionDiagnostic] ========== CHECKING DATABASE ==========`);

    const results = {
      rentalAccessCodesTable: null,
      bookingsTable: null,
      insertPermission: null,
      updatePermission: null,
      timestamp
    };

    try {
      // Check rental_access_codes table structure
      const { data: rentalData, error: rentalError } = await supabase
        .from('rental_access_codes')
        .select('*')
        .limit(1);

      results.rentalAccessCodesTable = {
        accessible: !rentalError,
        error: rentalError?.message,
        sampleRecord: rentalData?.[0] || null
      };

      console.log(`[${timestamp}] [EdgeFunctionDiagnostic] rental_access_codes check:`, results.rentalAccessCodesTable);

      // Check bookings table access
      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .select('id, pin_generated_at, pin_notification_sent_at')
        .eq('id', testPayload.booking_id)
        .single();

      results.bookingsTable = {
        accessible: !bookingError,
        error: bookingError?.message,
        bookingExists: !!bookingData,
        pinGeneratedAt: bookingData?.pin_generated_at || null,
        pinNotificationSentAt: bookingData?.pin_notification_sent_at || null
      };

      console.log(`[${timestamp}] [EdgeFunctionDiagnostic] bookings check:`, results.bookingsTable);

      // Test INSERT permission on rental_access_codes
      const testInsertData = {
        order_id: 99999,
        customer_email: 'diagnostic@test.com',
        customer_phone: '',
        access_pin: 'TEST-DIAGNOSTIC',
        pin_id: 'test-id',
        pin_type: 'bridge_proxied',
        lock_id: 'diagnostic-lock',
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        status: 'active'
      };

      const { data: insertData, error: insertError } = await supabase
        .from('rental_access_codes')
        .insert(testInsertData)
        .select('id')
        .single();

      results.insertPermission = {
        success: !insertError,
        error: insertError?.message,
        insertedId: insertData?.id || null
      };

      console.log(`[${timestamp}] [EdgeFunctionDiagnostic] INSERT test:`, results.insertPermission);

      // Clean up test record if inserted
      if (insertData?.id) {
        await supabase
          .from('rental_access_codes')
          .delete()
          .eq('id', insertData.id);

        console.log(`[${timestamp}] [EdgeFunctionDiagnostic] ✓ Cleaned up test record`);
      }

      // Test UPDATE permission on bookings
      const { error: updateError } = await supabase
        .from('bookings')
        .update({ pin_generated_at: new Date().toISOString() })
        .eq('id', testPayload.booking_id);

      results.updatePermission = {
        success: !updateError,
        error: updateError?.message
      };

      console.log(`[${timestamp}] [EdgeFunctionDiagnostic] UPDATE test:`, results.updatePermission);

      setDatabaseCheckResult(results);

      const allChecksPass = 
        results.rentalAccessCodesTable.accessible &&
        results.bookingsTable.accessible &&
        results.insertPermission.success &&
        results.updatePermission.success;

      toast({
        title: allChecksPass ? 'Database Checks Passed' : 'Database Issues Detected',
        description: allChecksPass 
          ? 'All database permissions are working correctly'
          : 'Some database checks failed - see details below',
        variant: allChecksPass ? 'default' : 'destructive'
      });

    } catch (err) {
      console.error(`[${timestamp}] [EdgeFunctionDiagnostic] Database check exception:`, err);
      
      results.exception = {
        message: err.message,
        stack: err.stack
      };

      setDatabaseCheckResult(results);

      toast({
        title: 'Database Check Failed',
        description: err.message,
        variant: 'destructive'
      });
    } finally {
      setCheckingDatabase(false);
    }
  };

  // Check specific order history
  const [orderIdToCheck, setOrderIdToCheck] = useState('1199');
  const [orderCheckResult, setOrderCheckResult] = useState(null);
  const [checkingOrder, setCheckingOrder] = useState(false);

  const handleCheckOrder = async () => {
    setCheckingOrder(true);
    setOrderCheckResult(null);

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [EdgeFunctionDiagnostic] Checking order #${orderIdToCheck}`);

    try {
      // Check booking record
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', parseInt(orderIdToCheck))
        .single();

      // Check rental_access_codes for this order
      const { data: accessCodes, error: accessError } = await supabase
        .from('rental_access_codes')
        .select('*')
        .eq('order_id', parseInt(orderIdToCheck))
        .order('created_at', { ascending: false });

      const result = {
        orderId: orderIdToCheck,
        booking: {
          found: !!booking,
          data: booking,
          error: bookingError?.message,
          status: booking?.status,
          plan: booking?.plan,
          email: booking?.email,
          phone: booking?.phone
        },
        accessCodes: {
          found: accessCodes?.length > 0,
          count: accessCodes?.length || 0,
          data: accessCodes,
          error: accessError?.message
        },
        timestamp
      };

      console.log(`[${timestamp}] [EdgeFunctionDiagnostic] Order check result:`, result);

      setOrderCheckResult(result);

      toast({
        title: `Order #${orderIdToCheck} Check Complete`,
        description: `Found ${result.accessCodes.count} access code(s)`,
      });

    } catch (err) {
      console.error(`[${timestamp}] [EdgeFunctionDiagnostic] Order check exception:`, err);
      
      setOrderCheckResult({
        orderId: orderIdToCheck,
        error: err.message,
        timestamp
      });

      toast({
        title: 'Order Check Failed',
        description: err.message,
        variant: 'destructive'
      });
    } finally {
      setCheckingOrder(false);
    }
  };

  const handlePayloadChange = (field, value) => {
    setTestPayload(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <>
      <Helmet>
        <title>Edge Function Diagnostics - Igloohome Integration</title>
      </Helmet>

      <div className="container mx-auto py-8 px-4 bg-slate-950 min-h-screen text-white">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-white/10 pb-4 mb-6">
            <Terminal className="h-8 w-8 text-yellow-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Edge Function Diagnostics</h1>
              <p className="text-gray-400">Investigate generate-igloohome-pin failures for orders #1199 & #1198</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Test Edge Function Card */}
            <Card className="bg-gradient-to-br from-blue-900/20 to-indigo-900/20 border-blue-500/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-400">
                  <Zap className="h-6 w-6" />
                  Test Edge Function
                </CardTitle>
                <CardDescription className="text-blue-200/70">
                  Invoke generate-igloohome-pin directly with test payload
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-gray-400 text-xs">Booking ID</Label>
                    <Input
                      type="number"
                      value={testPayload.booking_id}
                      onChange={(e) => handlePayloadChange('booking_id', parseInt(e.target.value))}
                      className="bg-black/50 border-gray-700 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-400 text-xs">Order ID</Label>
                    <Input
                      type="number"
                      value={testPayload.order_id}
                      onChange={(e) => handlePayloadChange('order_id', parseInt(e.target.value))}
                      className="bg-black/50 border-gray-700 text-white mt-1"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-gray-400 text-xs">Customer Email</Label>
                  <Input
                    type="email"
                    value={testPayload.customer_email}
                    onChange={(e) => handlePayloadChange('customer_email', e.target.value)}
                    className="bg-black/50 border-gray-700 text-white mt-1"
                  />
                </div>

                <div>
                  <Label className="text-gray-400 text-xs">Customer Phone</Label>
                  <Input
                    type="tel"
                    value={testPayload.customer_phone}
                    onChange={(e) => handlePayloadChange('customer_phone', e.target.value)}
                    className="bg-black/50 border-gray-700 text-white mt-1"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-gray-400 text-xs">Start Time (ISO 8601)</Label>
                    <Input
                      type="text"
                      value={testPayload.start_time}
                      onChange={(e) => handlePayloadChange('start_time', e.target.value)}
                      className="bg-black/50 border-gray-700 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-400 text-xs">End Time (ISO 8601)</Label>
                    <Input
                      type="text"
                      value={testPayload.end_time}
                      onChange={(e) => handlePayloadChange('end_time', e.target.value)}
                      className="bg-black/50 border-gray-700 text-white mt-1"
                    />
                  </div>
                </div>

                <Button
                  onClick={handleTestEdgeFunction}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Test Edge Function
                </Button>
              </CardContent>
            </Card>

            {/* Database Permissions Check */}
            <Card className="bg-gradient-to-br from-green-900/20 to-teal-900/20 border-green-500/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-400">
                  <Database className="h-6 w-6" />
                  Database Permissions
                </CardTitle>
                <CardDescription className="text-green-200/70">
                  Verify database access and RLS policies
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-black/30 p-3 rounded border border-green-500/20 text-xs">
                  <p className="text-green-300 font-semibold mb-2">Tests to run:</p>
                  <ul className="list-disc list-inside space-y-1 text-gray-300">
                    <li>rental_access_codes table accessibility</li>
                    <li>bookings table accessibility</li>
                    <li>INSERT permission test</li>
                    <li>UPDATE permission test</li>
                  </ul>
                </div>

                <Button
                  onClick={handleCheckDatabase}
                  disabled={checkingDatabase}
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                >
                  {checkingDatabase ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Database className="mr-2 h-4 w-4" />
                  )}
                  Check Database Permissions
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Order History Check */}
          <Card className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 border-purple-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-400">
                <FileJson className="h-6 w-6" />
                Order History Check
              </CardTitle>
              <CardDescription className="text-purple-200/70">
                Check specific order details and access code history
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label className="text-gray-400 text-xs">Order ID</Label>
                  <Input
                    type="number"
                    value={orderIdToCheck}
                    onChange={(e) => setOrderIdToCheck(e.target.value)}
                    placeholder="e.g. 1199"
                    className="bg-black/50 border-gray-700 text-white mt-1"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={handleCheckOrder}
                    disabled={checkingOrder}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {checkingOrder ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Check Order'
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Test Results */}
          {testResult && (
            <Card className="bg-gray-900 border-blue-500/30">
              <CardHeader className="bg-blue-900/10 border-b border-blue-500/20">
                <CardTitle className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle className="h-6 w-6 text-green-400" />
                  ) : (
                    <XCircle className="h-6 w-6 text-red-400" />
                  )}
                  <span className={testResult.success ? 'text-green-400' : 'text-red-400'}>
                    Edge Function Test Result
                  </span>
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  Duration: {testResult.duration}ms | Timestamp: {testResult.timestamp}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="bg-black text-green-400 p-4 font-mono text-xs overflow-auto max-h-[500px]">
                  <pre>{JSON.stringify(testResult, null, 2)}</pre>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Database Check Results */}
          {databaseCheckResult && (
            <Card className="bg-gray-900 border-green-500/30">
              <CardHeader className="bg-green-900/10 border-b border-green-500/20">
                <CardTitle className="text-green-400">Database Permission Check Results</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {/* rental_access_codes table */}
                <div className="bg-black/50 p-4 rounded border border-gray-800">
                  <div className="flex items-center gap-2 mb-2">
                    {databaseCheckResult.rentalAccessCodesTable?.accessible ? (
                      <CheckCircle className="h-5 w-5 text-green-400" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-400" />
                    )}
                    <p className="font-semibold text-white">rental_access_codes Table</p>
                  </div>
                  <pre className="text-xs text-gray-300 overflow-auto">
                    {JSON.stringify(databaseCheckResult.rentalAccessCodesTable, null, 2)}
                  </pre>
                </div>

                {/* bookings table */}
                <div className="bg-black/50 p-4 rounded border border-gray-800">
                  <div className="flex items-center gap-2 mb-2">
                    {databaseCheckResult.bookingsTable?.accessible ? (
                      <CheckCircle className="h-5 w-5 text-green-400" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-400" />
                    )}
                    <p className="font-semibold text-white">bookings Table</p>
                  </div>
                  <pre className="text-xs text-gray-300 overflow-auto">
                    {JSON.stringify(databaseCheckResult.bookingsTable, null, 2)}
                  </pre>
                </div>

                {/* INSERT permission */}
                <div className="bg-black/50 p-4 rounded border border-gray-800">
                  <div className="flex items-center gap-2 mb-2">
                    {databaseCheckResult.insertPermission?.success ? (
                      <CheckCircle className="h-5 w-5 text-green-400" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-400" />
                    )}
                    <p className="font-semibold text-white">INSERT Permission</p>
                  </div>
                  <pre className="text-xs text-gray-300 overflow-auto">
                    {JSON.stringify(databaseCheckResult.insertPermission, null, 2)}
                  </pre>
                </div>

                {/* UPDATE permission */}
                <div className="bg-black/50 p-4 rounded border border-gray-800">
                  <div className="flex items-center gap-2 mb-2">
                    {databaseCheckResult.updatePermission?.success ? (
                      <CheckCircle className="h-5 w-5 text-green-400" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-400" />
                    )}
                    <p className="font-semibold text-white">UPDATE Permission</p>
                  </div>
                  <pre className="text-xs text-gray-300 overflow-auto">
                    {JSON.stringify(databaseCheckResult.updatePermission, null, 2)}
                  </pre>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Order Check Results */}
          {orderCheckResult && (
            <Card className="bg-gray-900 border-purple-500/30">
              <CardHeader className="bg-purple-900/10 border-b border-purple-500/20">
                <CardTitle className="text-purple-400">Order #{orderCheckResult.orderId} Details</CardTitle>
                <CardDescription className="text-xs font-mono">{orderCheckResult.timestamp}</CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {/* Booking Info */}
                <div className="bg-black/50 p-4 rounded border border-gray-800">
                  <div className="flex items-center gap-2 mb-2">
                    {orderCheckResult.booking?.found ? (
                      <CheckCircle className="h-5 w-5 text-green-400" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-400" />
                    )}
                    <p className="font-semibold text-white">Booking Record</p>
                  </div>
                  <pre className="text-xs text-gray-300 overflow-auto max-h-[300px]">
                    {JSON.stringify(orderCheckResult.booking, null, 2)}
                  </pre>
                </div>

                {/* Access Codes */}
                <div className="bg-black/50 p-4 rounded border border-gray-800">
                  <div className="flex items-center gap-2 mb-2">
                    {orderCheckResult.accessCodes?.found ? (
                      <CheckCircle className="h-5 w-5 text-green-400" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-yellow-400" />
                    )}
                    <p className="font-semibold text-white">
                      Access Codes ({orderCheckResult.accessCodes?.count || 0} found)
                    </p>
                  </div>
                  <pre className="text-xs text-gray-300 overflow-auto max-h-[300px]">
                    {JSON.stringify(orderCheckResult.accessCodes, null, 2)}
                  </pre>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Instructions */}
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
              <CardTitle className="text-gray-300 text-sm">Diagnostic Instructions</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-gray-400 space-y-3">
              <div>
                <p className="font-semibold text-yellow-400 mb-1">Step 1: Test Edge Function</p>
                <p>Click "Test Edge Function" to invoke generate-igloohome-pin with the default payload. Check browser console for detailed logs.</p>
              </div>
              <div>
                <p className="font-semibold text-yellow-400 mb-1">Step 2: Check Database Permissions</p>
                <p>Click "Check Database Permissions" to verify RLS policies and table accessibility.</p>
              </div>
              <div>
                <p className="font-semibold text-yellow-400 mb-1">Step 3: Check Order History</p>
                <p>Enter order ID (1199 or 1198) and click "Check Order" to see booking details and access code records.</p>
              </div>
              <div>
                <p className="font-semibold text-yellow-400 mb-1">Step 4: Review Supabase Dashboard Logs</p>
                <p>Navigate to Supabase Dashboard → Edge Functions → generate-igloohome-pin → Logs to see server-side execution details.</p>
              </div>
              <div className="bg-red-950/30 border border-red-500/30 rounded p-3 mt-4">
                <p className="font-semibold text-red-400 mb-1">⚠️ Common Issues to Check:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Edge Function environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)</li>
                  <li>Igloohome API credentials (client_id, client_secret, lock_id)</li>
                  <li>Database RLS policies blocking service_role inserts</li>
                  <li>Network connectivity to Igloohome API (https://api.igloohome.co)</li>
                  <li>Booking record exists before calling Edge Function</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

export default EdgeFunctionDiagnosticPage;