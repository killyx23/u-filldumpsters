import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, LogIn, UserPlus, AlertCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingState, setLoadingState] = useState(false);
  const [showCreateAdmin, setShowCreateAdmin] = useState(true);
  
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    // Check if we were redirected here because of unauthorized access
    if (location.state?.error === 'unauthorized' && user && !isAdmin) {
      toast({
        variant: "destructive",
        title: "Access Denied",
        description: "You do not have administrative privileges. Signing out...",
      });
      signOut();
    }
  }, [location, user, isAdmin, signOut, toast]);

  useEffect(() => {
    // Wait for auth to settle before making routing decisions based on state
    if (!authLoading) {
      if (user) {
        console.log("[AdminLogin] User detected in state:", user.email);
        if (isAdmin) {
          console.log("[AdminLogin] User is admin. Redirecting to /admin...");
          toast({ title: "Login Successful", description: "Redirecting to dashboard..." });
          navigate('/admin', { replace: true });
        } else if (location.state?.error !== 'unauthorized') {
          // If we got here and aren't already handling the unauthorized state
          console.warn("[AdminLogin] User is NOT admin. Forcing sign out.");
          toast({
            variant: "destructive",
            title: "Access Denied",
            description: "You do not have administrative privileges.",
          });
          signOut();
        }
      }
    }
  }, [user, isAdmin, authLoading, navigate, signOut, toast, location.state]);

  const handleLogin = async (e) => {
    e.preventDefault();
    console.log("[AdminLogin] Initiating login attempt for:", email);
    setLoadingState(true);
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      
      if (error) {
        console.error("[AdminLogin] Login failed:", error.message);
        toast({
          variant: "destructive",
          title: "Login Failed",
          description: error.message,
        });
        setLoadingState(false);
        return;
      }
      
      console.log("[AdminLogin] Authentication successful. Awaiting AuthContext state update...");
      // We don't manually navigate here. The useEffect above will handle the navigation 
      // once the AuthContext updates the user and isAdmin states. This prevents race conditions.
      
    } catch (err) {
      console.error("[AdminLogin] Unexpected login error:", err);
      setLoadingState(false);
    }
  };

  const handleCreateFirstAdmin = async () => {
    const adminEmail = prompt("Please enter the email for the new admin user:");
    if (!adminEmail) {
      toast({ variant: "destructive", title: "Cancelled", description: "Admin user creation was cancelled." });
      return;
    }

    setLoadingState(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-first-admin', {
        body: { email: adminEmail },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      toast({
        title: "Admin User Created",
        description: `Successfully created admin user for ${adminEmail}. You can now log in.`,
      });
      setShowCreateAdmin(false);
    } catch (error) {
      console.error("Failed to create admin user:", error);
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
            <Loader2 className="h-12 w-12 text-yellow-400 animate-spin" />
          </div>
        )}
        
        <div className="text-center">
          <h1 className="text-3xl font-bold text-yellow-400">Admin Login</h1>
          <p className="mt-2 text-blue-200">Please sign in to access the dashboard.</p>
        </div>

        {location.state?.error === 'unauthorized' && (
           <div className="bg-red-900/40 border border-red-500 p-3 rounded-lg flex items-center text-red-200 text-sm">
             <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0 text-red-400" />
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
            <Button type="submit" className="w-full text-lg bg-yellow-500 hover:bg-yellow-600 text-black font-semibold" disabled={isUIBusy}>
              <LogIn className="mr-2 h-5 w-5" />
              {loadingState ? 'Authenticating...' : authLoading ? 'Verifying...' : 'Sign In'}
            </Button>
          </div>
        </form>
        {showCreateAdmin && (
          <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-white/20"></div>
            <span className="flex-shrink mx-4 text-blue-200 text-sm">First Time Setup</span>
            <div className="flex-grow border-t border-white/20"></div>
          </div>
        )}
        {showCreateAdmin && (
          <div>
            <Button onClick={handleCreateFirstAdmin} variant="outline" className="w-full bg-transparent border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black" disabled={isUIBusy}>
              <UserPlus className="mr-2 h-4 w-4" />
              Create First Admin User
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default AdminLogin;