import React, { useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, CheckCircle, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

const TestEmailPage = () => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('Test User');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  
  const [code, setCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);

  const addLog = (message, type = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message, type }]);
  };

  const handleSendTest = async (e) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    addLog(`Initiating send-verification-email for ${email}...`, 'info');

    try {
      const { data, error } = await supabase.functions.invoke('send-verification-email', {
        body: { email, name }
      });

      if (error) {
        addLog(`Supabase invoke error: ${error.message}`, 'error');
        console.error(error);
      } else if (data && data.success) {
        addLog(`Success! Edge function response: ${JSON.stringify(data)}`, 'success');
        if (data._debugCode) {
            addLog(`[DEBUG ONLY] Generated code: ${data._debugCode}`, 'warning');
        }
      } else {
        addLog(`Failed: ${JSON.stringify(data)}`, 'error');
      }
    } catch (err) {
      addLog(`Caught exception: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyTest = async (e) => {
    e.preventDefault();
    if (!email || !code) return;

    setVerifyLoading(true);
    addLog(`Initiating verify-email-code for ${email} with code ${code}...`, 'info');

    try {
      const { data, error } = await supabase.functions.invoke('verify-email-code', {
        body: { email, code }
      });

      if (error) {
        addLog(`Supabase invoke error: ${error.message}`, 'error');
      } else if (data && data.success) {
        addLog(`Code verified successfully! Response: ${JSON.stringify(data)}`, 'success');
      } else {
        addLog(`Verification failed: ${JSON.stringify(data)}`, 'error');
      }
    } catch (err) {
      addLog(`Caught exception: ${err.message}`, 'error');
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="bg-white/10 backdrop-blur-md border border-white/20 p-8 rounded-2xl shadow-xl">
        <h1 className="text-3xl font-bold text-white mb-2 flex items-center">
          <Mail className="mr-3 text-yellow-400" />
          Email System Debugger
        </h1>
        <p className="text-blue-200 mb-8 pb-4 border-b border-white/10">
          Use this tool to test the Resend integration via Edge Functions.
        </p>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="bg-black/20 p-6 rounded-xl border border-white/5">
              <h2 className="text-xl font-semibold text-white mb-4">1. Send Verification Email</h2>
              <form onSubmit={handleSendTest} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="test-name">Name</Label>
                  <Input 
                    id="test-name" 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    className="bg-white/5 border-white/20 text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="test-email">Email Address</Label>
                  <Input 
                    id="test-email" 
                    type="email" 
                    value={email} 
                    onChange={e => setEmail(e.target.value)} 
                    required 
                    className="bg-white/5 border-white/20 text-white"
                  />
                </div>
                <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700">
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  Send Test Email
                </Button>
              </form>
            </div>

            <div className="bg-black/20 p-6 rounded-xl border border-white/5">
              <h2 className="text-xl font-semibold text-white mb-4">2. Verify Code</h2>
              <form onSubmit={handleVerifyTest} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="test-code">Verification Code</Label>
                  <Input 
                    id="test-code" 
                    type="text" 
                    value={code} 
                    onChange={e => setCode(e.target.value)} 
                    placeholder="123456"
                    className="bg-white/5 border-white/20 text-white font-mono tracking-widest"
                  />
                </div>
                <Button type="submit" disabled={verifyLoading || !email} className="w-full bg-green-600 hover:bg-green-700">
                  {verifyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                  Verify Code
                </Button>
              </form>
            </div>
          </div>

          <div className="bg-black/40 rounded-xl border border-white/10 p-4 flex flex-col h-full">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-white/10">
              <h3 className="text-lg font-semibold text-gray-200">Execution Logs</h3>
              <Button variant="ghost" size="sm" onClick={() => setLogs([])} className="h-8 px-2 text-gray-400 hover:text-white">
                <RefreshCw className="h-4 w-4 mr-1" /> Clear
              </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 font-mono text-sm max-h-[500px]">
              {logs.length === 0 ? (
                <p className="text-gray-500 italic text-center mt-10">No logs yet. Run a test to see output.</p>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={`p-2 rounded border-l-2 ${
                    log.type === 'error' ? 'bg-red-900/20 border-red-500 text-red-300' :
                    log.type === 'success' ? 'bg-green-900/20 border-green-500 text-green-300' :
                    log.type === 'warning' ? 'bg-yellow-900/20 border-yellow-500 text-yellow-300' :
                    'bg-blue-900/20 border-blue-500 text-blue-300'
                  }`}>
                    <span className="text-gray-500 text-xs mr-2">[{log.time}]</span>
                    {log.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestEmailPage;