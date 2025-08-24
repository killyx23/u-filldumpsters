import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCreateAdmin, setShowCreateAdmin] = useState(true);
  const { signIn, user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user && user.user_metadata?.is_admin) {
      navigate('/admin');
    }
  }, [user, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) {
      setLoading(false);
      return;
    }

    setTimeout(async () => {
        const { data: { user: updatedUser } } = await supabase.auth.getUser();
        if (updatedUser && updatedUser.user_metadata?.is_admin) {
            toast({ title: "Login Successful", description: "Redirecting to dashboard..." });
            navigate('/admin');
        } else {
            toast({
                variant: "destructive",
                title: "Access Denied",
                description: "You do not have administrative privileges.",
            });
            await signOut(); 
        }
        setLoading(false);
    }, 500);
  };

  const handleCreateFirstAdmin = async () => {
    const adminEmail = prompt("Please enter the email for the new admin user:");
    if (!adminEmail) {
      toast({ variant: "destructive", title: "Cancelled", description: "Admin user creation was cancelled." });
      return;
    }

    setLoading(true);
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
      setShowCreateAdmin(false); // Hide button after successful creation
    } catch (error) {
      console.error("Failed to create admin user:", error);
      toast({
        variant: "destructive",
        title: "Creation Failed",
        description: error.message || "Could not create admin user. They may already exist.",
      });
    } finally {
      setLoading(false);
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
          <h1 className="text-3xl font-bold text-yellow-400">Admin Login</h1>
          <p className="mt-2 text-blue-200">Please sign in to access the dashboard.</p>
        </div>
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
              className="bg-white/10 text-white border-white/30 focus:ring-yellow-400"
              placeholder="admin@example.com"
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
              className="bg-white/10 text-white border-white/30 focus:ring-yellow-400"
              placeholder="••••••••"
            />
          </div>
          <div>
            <Button type="submit" className="w-full text-lg bg-yellow-500 hover:bg-yellow-600 text-black" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <LogIn className="mr-2 h-5 w-5" />}
              {loading ? 'Signing In...' : 'Sign In'}
            </Button>
          </div>
        </form>
        {showCreateAdmin && (
          <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-white/20"></div>
            <span className="flex-shrink mx-4 text-blue-200">First Time Setup</span>
            <div className="flex-grow border-t border-white/20"></div>
          </div>
        )}
        {showCreateAdmin && (
          <div>
            <Button onClick={handleCreateFirstAdmin} variant="outline" className="w-full bg-transparent border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black" disabled={loading}>
              <UserPlus className="mr-2 h-5 w-5" />
              Create First Admin User
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default AdminLogin;