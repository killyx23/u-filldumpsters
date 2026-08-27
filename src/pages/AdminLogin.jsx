
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, LogIn, AlertCircle, Shield } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    user,
    isAdmin,
    loading: authLoading,
    currentAal,
    needsMfaEnrollment,
    needsMfaChallenge,
    mfaReady,
    signIn,
    signOut,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  console.log('[AdminLogin] Component state:', {
    hasUser: !!user,
    userEmail: user?.email,
    isAdmin,
    authLoading,
    isSubmitting,
  });

  // Handle successful admin login — MFA enroll/challenge before dashboard
  useEffect(() => {
    if (authLoading || !mfaReady) return;

    if (isSubmitting && !user) {
      setIsSubmitting(false);
      return;
    }

    if (!user || !isAdmin) return;

    if (needsMfaEnrollment || needsMfaChallenge || currentAal !== 'aal2') {
      console.log('[AdminLogin] Admin authenticated — MFA required');
      setIsSubmitting(false);
      toast({
        title: 'Authenticator required',
        description: needsMfaEnrollment
          ? 'Set up an authenticator app to continue.'
          : 'Enter the code from your authenticator app.',
      });
      navigate('/admin-mfa', {
        replace: true,
        state: { from: location.state?.from },
      });
      return;
    }

    console.log('[AdminLogin] ✅ Admin user authenticated with MFA - redirecting to dashboard');
    setIsSubmitting(false);
    toast({
      title: 'Login Successful',
      description: `Welcome, ${user.email}`,
    });

    const from = location.state?.from?.pathname || '/admin/dashboard';
    navigate(from, { replace: true });
  }, [
    user,
    isAdmin,
    authLoading,
    currentAal,
    needsMfaEnrollment,
    needsMfaChallenge,
    mfaReady,
    isSubmitting,
    navigate,
    location,
    toast,
  ]);

  // Handle unauthorized redirect from AdminRouteGuard
  useEffect(() => {
    if (authLoading || !mfaReady) return;
    if (location.state?.error === 'unauthorized' && location.state?.userEmail) {
      console.warn('[AdminLogin] Unauthorized access detected:', location.state.userEmail);
      toast({
        variant: "destructive",
        title: "Access Denied",
        description: `${location.state.userEmail} does not have admin privileges.`,
      });

      if (user && !isAdmin) {
        signOut();
      }
    }
  }, [location.state, user, isAdmin, signOut, toast, authLoading, mfaReady]);

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Please enter both email and password.",
      });
      return;
    }

    console.log('[AdminLogin] Login attempt:', email);
    setIsSubmitting(true);

    try {
      const { error } = await signIn(email, password);

      if (error) {
        console.error('[AdminLogin] Login failed:', error.message);
        toast({
          variant: "destructive",
          title: "Login Failed",
          description: error.message,
        });
        setIsSubmitting(false);
        return;
      }

      console.log('[AdminLogin] Login successful - waiting for auth context to update');
      // Don't set isSubmitting to false here - let the navigation happen
      // The auth context will update and trigger the redirect useEffect
    } catch (err) {
      console.error('[AdminLogin] Unexpected error:', err);
      toast({
        variant: "destructive",
        title: "Error",
        description: err.message || "An unexpected error occurred.",
      });
      setIsSubmitting(false);
    }
  };

  const isLoading = isSubmitting || authLoading;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex items-center justify-center min-h-[calc(100vh-200px)] px-4"
    >
      <div className="w-full max-w-md p-8 space-y-6 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="bg-yellow-500 p-3 rounded-full">
              <Shield className="h-8 w-8 text-black" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-yellow-400">Admin Login</h1>
          <p className="text-blue-200">Sign in to access the dashboard</p>
        </div>

        {location.state?.error === 'unauthorized' && (
          <div className="bg-red-900/40 border border-red-500 p-4 rounded-lg">
            <div className="flex items-start text-red-200 text-sm">
              <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0 text-red-400 mt-0.5" />
              <div>
                <p className="font-semibold">Access Denied</p>
                <p className="mt-1">You do not have administrative privileges.</p>
              </div>
            </div>
          </div>
        )}

        <form className="space-y-4" onSubmit={handleLogin}>
          <div className="space-y-2">
            <Label htmlFor="email" className="text-white">Email Address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-white/10 text-white border-white/30 focus:ring-yellow-400 placeholder-white/40"
              placeholder="admin@example.com"
              disabled={isLoading}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="password" className="text-white">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-white/10 text-white border-white/30 focus:ring-yellow-400 placeholder-white/40"
              placeholder="••••••••"
              disabled={isLoading}
            />
          </div>

          <Button
            type="submit"
            className="w-full text-lg bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                {isSubmitting ? 'Signing In...' : 'Verifying...'}
              </>
            ) : (
              <>
                <LogIn className="mr-2 h-5 w-5" />
                Sign In
              </>
            )}
          </Button>
        </form>

        <div className="pt-4 border-t border-white/10">
          <p className="text-xs text-blue-300 text-center">
            💡 Check browser console for detailed authentication logs
          </p>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminLogin;
