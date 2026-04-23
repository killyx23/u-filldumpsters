
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, LogIn, UserPlus, AlertCircle, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

const loginLog = (label, data) => {
  console.log(
    `%c[AdminLogin] ${label}`,
    'background:#1e3a5f;color:#facc15;font-weight:bold;padding:2px 6px;border-radius:3px',
    data ?? ''
  );
};

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingState, setLoadingState] = useState(false);
  const [showCreateAdmin, setShowCreateAdmin] = useState(true);
  const [authError, setAuthError] = useState(null);
  const hasNavigated = useRef(false);

  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  // Log auth state changes for debugging
  useEffect(() => {
    loginLog('Auth state update', {
      userEmail: user?.email || 'NO USER',
      userId: user?.id || 'NO USER',
      isAdmin: isAdmin,
      authLoading: authLoading,
      hasNavigated: hasNavigated.current,
    });
  }, [user, isAdmin, authLoading]);

  // Handle unauthorized redirect from AdminRouteGuard
  useEffect(() => {
    if (location.state?.error === 'unauthorized') {
      loginLog('Unauthorized access detected from route guard', null);
      
      if (user && !isAdmin) {
        loginLog('User exists but not admin - signing out', user.email);
        setAuthError('You do not have administrative privileges.');
        toast({
          variant: "destructive",
          title: "Access Denied",
          description: "You do not have administrative privileges. Signing out...",
        });
        signOut();
      }
    }
  }, [location.state, user, isAdmin, signOut, toast]);

  // Handle authentication and navigation
  useEffect(() => {
    // Don't process if still loading or already navigated
    if (authLoading || hasNavigated.current) {
      loginLog('Skipping navigation logic', {
        reason: authLoading ? 'auth still loading' : 'already navigated',
      });
      return;
    }

    if (user) {
      loginLog('User authenticated - checking admin status', {
        email: user.email,
        isAdmin: isAdmin,
      });

      if (isAdmin) {
        loginLog('✅ User is admin - navigating to dashboard', null);
        hasNavigated.current = true;
        toast({
          title: "Login Successful",
          description: "Redirecting to admin dashboard...",
        });
        navigate('/admin', { replace: true });
      } else if (location.state?.error !== 'unauthorized') {
        // Only sign out if this isn't from an unauthorized redirect
        // (to prevent double sign-out)
        loginLog('❌ User is NOT admin - signing out', user.email);
        setAuthError('Access denied: Administrative privileges required.');
        toast({
          variant: "destructive",
          title: "Access Denied",
          description: "You do not have administrative privileges.",
        });
        signOut();
      }
    } else {
      loginLog('No user logged in - staying on login page', null);
      // Reset navigation flag when no user (allows re-login)
      hasNavigated.current = false;
    }
  }, [user, isAdmin, authLoading, navigate, signOut, toast, location.state]);

  const handleLogin = async (e) => {
    e.preventDefault();
    loginLog('Login form submitted', { email });
    
    setLoadingState(true);
    setAuthError(null);
    hasNavigated.current = false; // Reset navigation flag

    try {
      loginLog('Attempting Supabase authentication...', { email });
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        loginLog('❌ Authentication failed', error.message);
        setAuthError(error.message);
        toast({
          variant: "destructive",
          title: "Login Failed",
          description: error.message,
        });
        setLoadingState(false);
        return;
      }

      loginLog('✅ Authentication successful', {
        email: data.user?.email,
        userId: data.user?.id,
        app_metadata: data.user?.app_metadata,
        user_metadata: data.user?.user_metadata,
      });

      // Check if user has admin flag
      const hasAdminFlag = data.user?.app_metadata?.is_admin || 
                          data.user?.user_metadata?.is_admin ||
                          false;

      loginLog('Admin flag check', {
        hasAdminFlag: hasAdminFlag,
        app_metadata_is_admin: data.user?.app_metadata?.is_admin,
        user_metadata_is_admin: data.user?.user_metadata?.is_admin,
      });

      if (!hasAdminFlag) {
        loginLog('⚠️ User authenticated but no admin flag found', {
          message: 'Run query to set is_admin flag in Supabase',
          user_id: data.user?.id,
        });
        setAuthError('Admin privileges not detected. Please verify your account setup.');
        toast({
          variant: "destructive",
          title: "Access Denied",
          description: "Your account does not have administrative privileges.",
        });
        await signOut();
        setLoadingState(false);
        return;
      }

      loginLog('Waiting for AuthContext to update isAdmin state...', null);
      // Navigation will be handled by useEffect once AuthContext updates

    } catch (err) {
      loginLog('❌ Unexpected login error', err.message);
      setAuthError('An unexpected error occurred. Please try again.');
      toast({
        variant: "destructive",
        title: "Login Error",
        description: err.message || "An unexpected error occurred.",
      });
      setLoadingState(false);
    }
  };

  const handleRetry = () => {
    loginLog('Retry button clicked - resetting form', null);
    setAuthError(null);
    setLoadingState(false);
    setEmail('');
    setPassword('');
    hasNavigated.current = false;
  };

  const handleCreateFirstAdmin = async () => {
    const adminEmail = prompt("Please enter the email for the new admin user:");
    if (!adminEmail) {
      toast({
        variant: "destructive",
        title: "Cancelled",
        description: "Admin user creation was cancelled.",
      });
      return;
    }

    loginLog('Creating first admin user', { adminEmail });
    setLoadingState(true);
    setAuthError(null);

    try {
      const { data, error } = await supabase.functions.invoke('create-first-admin', {
        body: { email: adminEmail },
      });

      if (error) {
        loginLog('❌ Edge function error', error.message);
        throw error;
      }

      if (data.error) {
        loginLog('❌ Function returned error', data.error);
        throw new Error(data.error);
      }

      loginLog('✅ Admin user created successfully', {
        email: adminEmail,
        userId: data.user?.id,
      });

      toast({
        title: "Admin User Created",
        description: `Successfully created admin user for ${adminEmail}. You can now log in.`,
      });
      setShowCreateAdmin(false);
    } catch (error) {
      loginLog('❌ Failed to create admin user', error.message);
      setAuthError(error.message || 'Failed to create admin user');
      toast({
        variant: "destructive",
        title: "Creation Failed",
        description: error.message || "Could not create admin user. They may already exist.",
      });
    } finally {
      setLoadingState(false);
    }
  };

  const isUIBusy = loadingState || authLoading;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex items-center justify-center min-h-[calc(100vh-200px)] px-4"
    >
      <div className="w-full max-w-md p-8 space-y-8 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20 relative overflow-hidden">
        {isUIBusy && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="h-12 w-12 text-yellow-400 animate-spin mx-auto mb-2" />
              <p className="text-white text-sm">
                {loadingState ? 'Authenticating...' : 'Verifying permissions...'}
              </p>
            </div>
          </div>
        )}

        <div className="text-center">
          <h1 className="text-3xl font-bold text-yellow-400">Admin Login</h1>
          <p className="mt-2 text-blue-200">Please sign in to access the dashboard.</p>
        </div>

        {authError && (
          <div className="bg-red-900/40 border border-red-500 p-4 rounded-lg space-y-3">
            <div className="flex items-start text-red-200 text-sm">
              <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0 text-red-400 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Authentication Error</p>
                <p className="mt-1">{authError}</p>
              </div>
            </div>
            <Button
              onClick={handleRetry}
              variant="outline"
              size="sm"
              className="w-full bg-red-950/50 border-red-500 text-red-200 hover:bg-red-900"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </div>
        )}

        {location.state?.error === 'unauthorized' && !authError && (
          <div className="bg-orange-900/40 border border-orange-500 p-3 rounded-lg flex items-center text-orange-200 text-sm">
            <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0 text-orange-400" />
            You must be an administrator to access that page.
          </div>
        )}

        <form className="space-y-6" onSubmit={handleLogin}>
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
              disabled={isUIBusy}
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
              disabled={isUIBusy}
            />
          </div>
          <div>
            <Button
              type="submit"
              className="w-full text-lg bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
              disabled={isUIBusy}
            >
              <LogIn className="mr-2 h-5 w-5" />
              {loadingState ? 'Authenticating...' : authLoading ? 'Verifying...' : 'Sign In'}
            </Button>
          </div>
        </form>

        {showCreateAdmin && (
          <>
            <div className="relative flex py-5 items-center">
              <div className="flex-grow border-t border-white/20"></div>
              <span className="flex-shrink mx-4 text-blue-200 text-sm">First Time Setup</span>
              <div className="flex-grow border-t border-white/20"></div>
            </div>
            <div>
              <Button
                onClick={handleCreateFirstAdmin}
                variant="outline"
                className="w-full bg-transparent border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black"
                disabled={isUIBusy}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Create First Admin User
              </Button>
            </div>
          </>
        )}

        <div className="pt-4 border-t border-white/10">
          <p className="text-xs text-blue-300 text-center">
            🔍 Check browser console for detailed authentication logs
          </p>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminLogin;
