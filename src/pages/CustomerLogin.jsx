import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Mail, Loader2, ShieldCheck, KeyRound, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

const CustomerLogin = () => {
  const [customerId, setCustomerId] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handlePhoneChange = (e) => {
    const input = e.target.value.replace(/\D/g, '');
    let formattedPhone = '';
    if (input.length > 0) {
      formattedPhone = `(${input.substring(0, 3)}`;
    }
    if (input.length > 3) {
      formattedPhone += `) ${input.substring(3, 6)}`;
    }
    if (input.length > 6) {
      formattedPhone += `-${input.substring(6, 10)}`;
    }
    setPhone(formattedPhone);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const rawPhone = phone.replace(/\D/g, '');
    if (rawPhone.length !== 10) {
      toast({
        title: 'Invalid Phone Number',
        description: 'Please enter a valid 10-digit phone number.',
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-login', {
        body: JSON.stringify({ customerId, phone: rawPhone }),
      });

      if (error) {
        throw new Error(error.message);
      }
      
      if (data.error) {
        throw new Error(data.error);
      }

      setEmailSent(true);
      toast({
        title: 'Login Link Sent!',
        description: 'Check your email for a secure link to access your portal.',
      });
    } catch (error) {
      console.error('Login error:', error);
      toast({
        title: 'Login Failed',
        description: error.message || 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Customer Portal Login - U-Fill Dumpsters</title>
        <meta name="description" content="Access your U-Fill Dumpsters customer portal to manage your bookings and view your history." />
      </Helmet>
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {!emailSent ? (
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
              <div className="text-center mb-8">
                <ShieldCheck className="mx-auto h-16 w-16 text-yellow-400 mb-4" />
                <h1 className="text-3xl font-bold text-white">Customer Portal</h1>
                <p className="text-gray-300 mt-2">Enter your details to receive a secure login link.</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="customer-id" className="text-gray-200 flex items-center"><KeyRound className="w-4 h-4 mr-2" />Customer ID</Label>
                  <Input
                    id="customer-id"
                    type="text"
                    placeholder="e.g., CID-123456"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    required
                    className="bg-white/10 border-white/20 placeholder:text-gray-400"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-gray-200 flex items-center"><Phone className="w-4 h-4 mr-2" />Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="(555) 555-5555"
                    value={phone}
                    onChange={handlePhoneChange}
                    required
                    className="bg-white/10 border-white/20 placeholder:text-gray-400"
                  />
                </div>
                <Button type="submit" className="w-full bg-yellow-400 text-black hover:bg-yellow-500 font-bold text-lg py-6" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Get Login Link'
                  )}
                </Button>
              </form>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 text-center"
            >
              <Mail className="mx-auto h-20 w-20 text-green-400 mb-6" />
              <h2 className="text-3xl font-bold text-white">Check Your Inbox!</h2>
              <p className="text-gray-300 mt-4 text-lg">
                A secure, one-time login link has been sent to the email address associated with your account.
              </p>
              <p className="text-gray-400 mt-4">
                Please click the link in the email to access your portal. The link will expire in 24 hours.
              </p>
              <Button onClick={() => setEmailSent(false)} className="mt-8 bg-yellow-400 text-black hover:bg-yellow-500 font-bold">
                Request a New Link
              </Button>
            </motion.div>
          )}
        </motion.div>
      </div>
    </>
  );
};

export default CustomerLogin;