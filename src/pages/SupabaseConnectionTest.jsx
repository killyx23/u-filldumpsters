
import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Loader2, RefreshCw, Database, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const TestResult = ({ name, status, data, error }) => {
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status === 'loading' && <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
          {status === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
          {status === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
          {name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {status === 'loading' && <p className="text-gray-500">Testing connection...</p>}
        {status === 'success' && (
          <div className="space-y-2">
            <p className="text-green-600 font-semibold">✓ Connection successful</p>
            <div className="bg-gray-50 p-3 rounded text-sm">
              <p className="font-mono">Records found: {data?.length || 0}</p>
              {data && data.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-blue-600 hover:underline">
                    View sample data
                  </summary>
                  <pre className="mt-2 overflow-auto max-h-40 text-xs">
                    {JSON.stringify(data.slice(0, 3), null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}
        {status === 'error' && (
          <div className="space-y-2">
            <p className="text-red-600 font-semibold">✗ Connection failed</p>
            <div className="bg-red-50 border border-red-200 p-3 rounded text-sm">
              <p className="font-semibold text-red-700">Error Message:</p>
              <p className="font-mono text-red-600">{error?.message || 'Unknown error'}</p>
              {error?.details && (
                <>
                  <p className="font-semibold text-red-700 mt-2">Details:</p>
                  <p className="font-mono text-red-600">{error.details}</p>
                </>
              )}
              {error?.hint && (
                <>
                  <p className="font-semibold text-red-700 mt-2">Hint:</p>
                  <p className="font-mono text-red-600">{error.hint}</p>
                </>
              )}
              {error?.code && (
                <>
                  <p className="font-semibold text-red-700 mt-2">Error Code:</p>
                  <p className="font-mono text-red-600">{error.code}</p>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const SupabaseConnectionTest = () => {
  const [tests, setTests] = useState({
    client: { name: 'Supabase Client Initialization', status: 'idle' },
    services: { name: 'Services Table', status: 'idle' },
    dumpFees: { name: 'Dump Fees Table', status: 'idle' },
    reviews: { name: 'Reviews Table', status: 'idle' },
    dateAvailability: { name: 'Date Specific Availability Table', status: 'idle' },
  });

  const runTest = async (testName, tableName, query) => {
    setTests(prev => ({
      ...prev,
      [testName]: { ...prev[testName], status: 'loading' }
    }));

    try {
      const { data, error } = await query();
      
      if (error) throw error;
      
      setTests(prev => ({
        ...prev,
        [testName]: { 
          ...prev[testName], 
          status: 'success',
          data 
        }
      }));
    } catch (error) {
      console.error(`[Test] ${testName} failed:`, error);
      setTests(prev => ({
        ...prev,
        [testName]: { 
          ...prev[testName], 
          status: 'error',
          error 
        }
      }));
    }
  };

  const runAllTests = async () => {
    console.log('[Diagnostic] Starting Supabase connection tests...');
    
    // Test 1: Client initialization
    setTests(prev => ({
      ...prev,
      client: { 
        ...prev.client, 
        status: supabase ? 'success' : 'error',
        data: supabase ? { initialized: true } : null,
        error: supabase ? null : { message: 'Supabase client not initialized' }
      }
    }));

    // Test 2: Services table
    await runTest('services', 'services', () => 
      supabase.from('services').select('*').limit(5)
    );

    // Test 3: Dump fees table
    await runTest('dumpFees', 'dump_fees', () => 
      supabase.from('dump_fees').select('*, services(id, name)').limit(5)
    );

    // Test 4: Reviews table
    await runTest('reviews', 'reviews', () => 
      supabase.from('reviews').select('*').eq('is_public', true).limit(5)
    );

    // Test 5: Date specific availability
    await runTest('dateAvailability', 'date_specific_availability', () => 
      supabase.from('date_specific_availability').select('*').limit(5)
    );

    console.log('[Diagnostic] All tests completed');
  };

  useEffect(() => {
    runAllTests();
  }, []);

  const envVars = {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY
  };

  const allSuccess = Object.values(tests).every(test => test.status === 'success');
  const anyError = Object.values(tests).some(test => test.status === 'error');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 py-12 px-4">
      <Helmet>
        <title>Supabase Connection Test - U-Fill Dumpsters</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="container mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-4 flex items-center gap-3">
            <Database className="h-10 w-10 text-yellow-400" />
            Supabase Connection Diagnostic
          </h1>
          <p className="text-blue-200 text-lg">
            This page tests the connection to Supabase and verifies data access for critical tables.
          </p>
        </div>

        {allSuccess && (
          <Alert className="mb-6 bg-green-50 border-green-200">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <AlertTitle className="text-green-800">All Tests Passed!</AlertTitle>
            <AlertDescription className="text-green-700">
              All Supabase connections are working correctly. Your database is properly configured.
            </AlertDescription>
          </Alert>
        )}

        {anyError && (
          <Alert className="mb-6 bg-red-50 border-red-200">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <AlertTitle className="text-red-800">Connection Issues Detected</AlertTitle>
            <AlertDescription className="text-red-700">
              Some tests failed. Review the errors below and check your Supabase configuration.
            </AlertDescription>
          </Alert>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Environment Configuration</CardTitle>
            <CardDescription>Verify your environment variables are set correctly</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 font-mono text-sm">
              <div className="flex items-center gap-2">
                {envVars.VITE_SUPABASE_URL ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span className="font-semibold">VITE_SUPABASE_URL:</span>
                <span className="text-gray-600">
                  {envVars.VITE_SUPABASE_URL || '(not set)'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {envVars.VITE_SUPABASE_ANON_KEY ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span className="font-semibold">VITE_SUPABASE_ANON_KEY:</span>
                <span className="text-gray-600">
                  {envVars.VITE_SUPABASE_ANON_KEY ? '(set - hidden for security)' : '(not set)'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mb-6">
          <Button onClick={runAllTests} className="w-full bg-blue-600 hover:bg-blue-700">
            <RefreshCw className="h-4 w-4 mr-2" />
            Rerun All Tests
          </Button>
        </div>

        <div className="space-y-4">
          {Object.entries(tests).map(([key, test]) => (
            <TestResult
              key={key}
              name={test.name}
              status={test.status}
              data={test.data}
              error={test.error}
            />
          ))}
        </div>

        <div className="mt-8 p-4 bg-white/10 rounded-lg">
          <h3 className="text-lg font-semibold text-white mb-2">Troubleshooting Tips:</h3>
          <ul className="text-blue-200 space-y-2 text-sm list-disc list-inside">
            <li>Verify .env.local file contains correct VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY</li>
            <li>Check that RLS (Row Level Security) policies allow anonymous SELECT access</li>
            <li>Ensure tables exist in your Supabase project</li>
            <li>Verify network connectivity to Supabase servers</li>
            <li>Check browser console for additional error details</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SupabaseConnectionTest;
