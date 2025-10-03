import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, LogIn, Mail } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const CustomerLogin = () => {
  const [customerId, setCustomerId] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user, loading: authLoading, setManualSession } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [showForgotDialog, setShowForgotDialog] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [isSendingRecovery, setIsSendingRecovery] = useState(false);

  useEffect(() => {
    if (!authLoading && user && !user.user_metadata?.is_admin) {
      navigate('/portal');
    }
  }, [user, authLoading, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (isSubmitting || !customerId || !phone) return;
    setIsSubmitting(true);
    
    try {
        const { data, error } = await supabase.functions.invoke('customer-portal-login', {
            body: { customerId, phone },
        });

        if (error) throw error;
        
        const responseData = data;
        if (responseData.error) throw new Error(responseData.error);

        if (responseData.session) {
            await setManualSession({
              access_token: responseData.session.access_token,
              refresh_token: responseData.session.refresh_token,
            });
            toast({ title: "Login Successful", description: "Redirecting to your portal..." });
            navigate('/portal');
        } else {
            throw new Error("An unknown error occurred during sign-in.");
        }
    } catch (error) {
        let errorMessage = "An unknown error occurred.";
        if (error instanceof Error) {
            errorMessage = error.message;
        } else if (typeof error === 'string') {
            errorMessage = error;
        }
        
        toast({
            variant: "destructive",
            title: "Login Failed",
            description: errorMessage,
        });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleRecovery = async (e) => {
    e.preventDefault();
    if (isSendingRecovery || !recoveryEmail) return;
    setIsSendingRecovery(true);

    try {
      const { error } = await supabase.functions.invoke('send-customer-id', {
        body: { email: recoveryEmail },
      });

      if (error) throw error;

      toast({
        title: "Recovery Email Sent",
        description: "If an account with that email exists, your Customer ID has been sent.",
      });
      setShowForgotDialog(false);
      setRecoveryEmail('');
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Recovery Failed",
        description: error.message || "An error occurred. Please try again.",
      });
    } finally {
      setIsSendingRecovery(false);
    }
  };

  return (
    <>
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
            <div className="text-right">
              <Button
                type="button"
                variant="link"
                className="p-0 h-auto text-yellow-400 hover:text-yellow-300"
                onClick={() => setShowForgotDialog(true)}
              >
                Forgot your Customer ID?
              </Button>
            </div>
            <div>
              <Button type="submit" disabled={isSubmitting || authLoading} className="w-full py-3 text-lg font-semibold">
                {isSubmitting || authLoading ? (
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

      <Dialog open={showForgotDialog} onOpenChange={setShowForgotDialog}>
        <DialogContent className="sm:max-w-[425px] bg-gray-800 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle>Recover Customer ID</DialogTitle>
            <DialogDescription>
              Enter the email address associated with your booking. If it matches our records, we'll send you your Customer ID.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRecovery}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="recovery-email" className="text-right">
                  Email
                </Label>
                <Input
                  id="recovery-email"
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  className="col-span-3"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isSendingRecovery}>
                {isSendingRecovery ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                Send Recovery Email
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CustomerLogin;