import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Play, Database, Key, AlertTriangle, CheckCircle, FileCode, Search, Terminal, Globe } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';

const IgloohomeDebugPage = () => {
  const [orderId, setOrderId] = useState('1195');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [funcDef, setFuncDef] = useState('');
  const [fetchingFunc, setFetchingFunc] = useState(false);
  const [oauthEndpoint, setOauthEndpoint] = useState('');
  const [analyzingEndpoint, setAnalyzingEndpoint] = useState(false);

  // Extract OAuth endpoint from function definition
  const extractOAuthEndpoint = (functionDef) => {
    if (!functionDef) return null;

    // Look for OAuth token URL patterns
    const patterns = [
      /https?:\/\/[^\s'"]+oauth[^\s'"]+token[^\s'"]*/gi,
      /oauth_url[^\n]*:=[^\n]*'([^']+)'/gi,
      /token_url[^\n]*:=[^\n]*'([^']+)'/gi,
      /'(https?:\/\/api\.igloohome\.[^']+oauth[^']+)'/gi,
    ];

    for (const pattern of patterns) {
      const matches = functionDef.match(pattern);
      if (matches && matches.length > 0) {
        return matches[0].replace(/['"]/g, '');
      }
    }

    return null;
  };

  // Analyze OAuth endpoint
  const analyzeOAuthEndpoint = async () => {
    setAnalyzingEndpoint(true);
    try {
      // First fetch the function definition
      const { data: funcData, error: funcError } = await supabase.rpc('generate_igloohome_pin_rpc', {
        p_booking_id: 0,
        p_order_id: 0,
        p_customer_email: 'diagnostic@test.com',
        p_customer_phone: '',
        p_start_time: new Date().toISOString(),
        p_end_time: new Date().toISOString()
      });

      // This will fail but we can check the logs
      console.log('RPC test response:', funcData);

      // Try to extract from PostgreSQL directly
      const { data: pgData, error: pgError } = await supabase
        .from('pg_proc')
        .select('prosrc')
        .eq('proname', 'generate_igloohome_pin_rpc')
        .single();

      if (pgData) {
        const endpoint = extractOAuthEndpoint(pgData.prosrc);
        setOauthEndpoint(endpoint || 'Could not extract endpoint from function');
      }

      toast({
        title: 'Analysis Complete',
        description: 'Check the results below for OAuth endpoint details'
      });

    } catch (err) {
      console.error('Analysis error:', err);
      setOauthEndpoint('Error analyzing function - check console logs');
    } finally {
      setAnalyzingEndpoint(false);
    }
  };

  // Function to fetch the definition directly from pg_proc
  const fetchFunctionDefinition = async () => {
    setFetchingFunc(true);
    try {
      // Try direct query to information_schema
      const { data: routineData, error: routineError } = await supabase
        .from('information_schema.routines')
        .select('routine_definition')
        .eq('routine_name', 'generate_igloohome_pin_rpc')
        .eq('routine_schema', 'public')
        .single();

      if (routineData && routineData.routine_definition) {
        const def = routineData.routine_definition;
        setFuncDef(def);
        
        // Extract OAuth endpoint
        const endpoint = extractOAuthEndpoint(def);
        if (endpoint) {
          setOauthEndpoint(endpoint);
          
          // Validate endpoint
          if (!endpoint.startsWith('https://')) {
            toast({
              title: '⚠️ Security Issue Detected',
              description: 'OAuth endpoint does not use HTTPS!',
              variant: 'destructive'
            });
          } else {
            toast({
              title: '✓ Endpoint Uses HTTPS',
              description: endpoint,
            });
          }
        }
      } else {
        // Fallback: Show function exists but definition not accessible
        setFuncDef('Function exists in database but definition requires service_role access to view.\n\nTo view the complete function definition:\n1. Go to Supabase Dashboard\n2. Navigate to SQL Editor\n3. Run: SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = \'generate_igloohome_pin_rpc\';');
      }
    } catch (err) {
      console.error('Failed to fetch definition:', err);
      setFuncDef(`Error: ${err.message}\n\nThe function definition requires elevated database permissions to view.\n\nPlease use the Supabase Dashboard SQL Editor to inspect the function.`);
    } finally {
      setFetchingFunc(false);
    }
  };

  const handleCheckAccessCode = async () => {
    if (!orderId) {
      toast({ title: 'Error', description: 'Please enter an Order ID', variant: 'destructive' });
      return;
    }

    setLoading(true);
    setResults(null);

    try {
      // Direct Table Query
      const { data, error, count } = await supabase
        .from('rental_access_codes')
        .select('*', { count: 'exact' })
        .eq('order_id', parseInt(orderId))
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      setResults({
        query: `SELECT * FROM public.rental_access_codes WHERE order_id = ${orderId} ORDER BY created_at DESC LIMIT 5;`,
        timestamp: new Date().toISOString(),
        count: count,
        records: data
      });

      toast({ 
        title: 'Diagnostic Complete', 
        description: `Found ${data.length} recent records for Order #${orderId}` 
      });

    } catch (err) {
      setResults({ error: err.message });
      toast({ title: 'Query Failed', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Igloohome OAuth Diagnostic - Admin</title>
      </Helmet>

      <div className="container mx-auto py-8 px-4 bg-slate-950 min-h-screen text-white">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4 mb-6">
            <Terminal className="h-8 w-8 text-yellow-400" />
            <div>
              <h1 className="text-3xl font-bold text-white">Igloohome OAuth Endpoint Diagnostic</h1>
              <p className="text-gray-400">Database Function Analysis & OAuth URL Verification</p>
            </div>
          </div>

          {/* OAuth Endpoint Verification Card */}
          <Card className="bg-gradient-to-br from-yellow-900/20 to-orange-900/20 border-yellow-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-yellow-400">
                <Globe className="h-6 w-6" />
                OAuth Endpoint Status
              </CardTitle>
              <CardDescription className="text-yellow-200/70">
                Verify the Igloohome OAuth endpoint uses HTTPS and is correctly configured
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {oauthEndpoint && (
                <div className="bg-black/50 p-4 rounded border border-yellow-500/30">
                  <p className="text-xs text-gray-400 mb-2">Current OAuth Endpoint:</p>
                  <code className="text-sm text-yellow-300 font-mono break-all">
                    {oauthEndpoint}
                  </code>
                  
                  <div className="mt-4 flex items-start gap-2">
                    {oauthEndpoint.startsWith('https://') ? (
                      <>
                        <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-green-400 font-medium">✓ HTTPS Verified</p>
                          <p className="text-gray-400 text-sm">Endpoint uses secure HTTPS protocol</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-red-400 font-medium">⚠️ Security Issue</p>
                          <p className="text-gray-400 text-sm">Endpoint does not use HTTPS - this is insecure!</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              
              <Button 
                onClick={fetchFunctionDefinition}
                disabled={fetchingFunc}
                className="w-full bg-yellow-600 hover:bg-yellow-700 text-white"
              >
                {fetchingFunc ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileCode className="mr-2 h-4 w-4" />
                )}
                Extract OAuth Endpoint from Database Function
              </Button>

              <div className="text-xs text-gray-400 bg-gray-900/50 p-3 rounded border border-gray-800">
                <p className="font-medium text-yellow-400 mb-1">Expected Endpoint:</p>
                <code className="text-green-400">https://api.igloohome.co/v2/oauth/token</code>
                <p className="mt-2 text-gray-500">
                  The OAuth endpoint MUST start with <code className="text-yellow-300">https://</code> for security.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Panel: Query Controls */}
            <div className="lg:col-span-1 space-y-6">
              <Card className="bg-gray-900 border-blue-500/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <Search className="h-5 w-5 text-blue-400" />
                    Access Code Inspector
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="orderId" className="text-gray-400">Order ID</Label>
                    <Input
                      id="orderId"
                      type="number"
                      value={orderId}
                      onChange={(e) => setOrderId(e.target.value)}
                      placeholder="e.g. 1195"
                      className="bg-black/50 border-gray-700 text-white mt-1"
                    />
                  </div>
                  <Button 
                    onClick={handleCheckAccessCode} 
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {loading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Database className="mr-2 h-4 w-4" />
                    )}
                    Check Access Codes
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Right Panel: Results Display */}
            <div className="lg:col-span-2 space-y-6">
              {results && (
                <Card className="bg-gray-900 border-blue-500/30 overflow-hidden">
                  <CardHeader className="bg-blue-900/10 border-b border-blue-500/20">
                    <CardTitle className="text-blue-400 flex items-center gap-2">
                      <Database className="h-5 w-5" />
                      Query Results
                    </CardTitle>
                    <CardDescription className="font-mono text-xs text-blue-300/50">
                      {results.query}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="bg-black text-green-400 p-4 font-mono text-xs overflow-auto max-h-[400px]">
                      {results.error ? (
                        <div className="text-red-400 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          {results.error}
                        </div>
                      ) : (
                        <pre>{JSON.stringify(results.records, null, 2)}</pre>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {funcDef && (
                <Card className="bg-gray-900 border-green-500/30">
                  <CardHeader>
                    <CardTitle className="text-green-400">Database Function Source</CardTitle>
                    <CardDescription className="text-gray-400">
                      generate_igloohome_pin_rpc definition
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-black p-4 rounded border border-gray-800 overflow-auto max-h-[500px]">
                      <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">
                        {funcDef}
                      </pre>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Instructions Panel */}
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
              <CardTitle className="text-gray-300 text-sm">Manual Verification Steps</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-gray-400 space-y-2">
              <p>If automatic extraction fails, verify manually in Supabase Dashboard:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Go to Supabase Dashboard → SQL Editor</li>
                <li>Run: <code className="bg-black/50 px-2 py-0.5 rounded text-yellow-300">SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'generate_igloohome_pin_rpc';</code></li>
                <li>Search for "oauth" in the output</li>
                <li>Verify the URL starts with <code className="text-green-400">https://</code></li>
                <li>Expected: <code className="text-green-400">https://api.igloohome.co/v2/oauth/token</code></li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

export default IgloohomeDebugPage;