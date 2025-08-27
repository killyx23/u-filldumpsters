import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, LogIn } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const CustomerLogin = () => {
  const [customerId, setCustomerId] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { session, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // If user is already logged in (and not an admin), redirect to portal
    if (!authLoading && user && !user.user_metadata?.is_admin) {
      navigate('/portal');
    }
  }, [user, authLoading, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-login', {
        body: { customerId, phone },
      });

      if (error) throw new Error(error.message);

      if (data.error) {
        toast({
          variant: "destructive",
          title: "Login Failed",
          description: data.error,
        });
      } else {
        // The AuthProvider's onAuthStateChange will handle setting the session
        // and trigger the useEffect to navigate to the portal.
        toast({
          title: "Login Successful",
          description: "Redirecting to your portal...",
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: error.message || 'An unexpected error occurred. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex items-center justify-center min-h-[calc(100vh-200px)]"
    >
      <div className="w-full max-w-md p-8 space-y-8 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-yellow-400">Customer Portal Login</h1>
          <p className="mt-2 text-blue-200">Access your booking history and details.</p>
        </div>
        <form className="space-y-6" onSubmit={handleLogin}>
          <div className="space-y-2">
            <Label htmlFor="customerId" className="text-white">Customer ID</Label>
            <Input
              id="customerId"
              name="customerId"
              type="text"
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="e.g., CID-123456"
            />
             <p className="text-xs text-blue-300 pt-1">You can find your Customer ID on your booking confirmation email or receipt.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone" className="text-white">Phone Number</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
            />
          </div>
          <div>
            <Button type="submit" disabled={isSubmitting} className="w-full py-3 text-lg font-semibold">
              {isSubmitting ? (
                <Loader2 className="mr-2 h-6 w-6 animate-spin" />
              ) : (
                <LogIn className="mr-2 h-5 w-5" />
              )}
              Sign In
            </Button>
          </div>
        </form>
      </div>
    </motion.div>
  );
};

export default CustomerLogin;