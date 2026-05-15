
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check if user has admin privileges
  const checkAdminStatus = useCallback(async (currentUser) => {
    if (!currentUser) {
      setIsAdmin(false);
      return false;
    }

    // Check metadata first (fastest method)
    const adminFromMetadata = 
      currentUser.app_metadata?.is_admin === true || 
      currentUser.user_metadata?.is_admin === true;

    if (adminFromMetadata) {
      console.log('[AuthContext] Admin status confirmed via metadata:', currentUser.email);
      setIsAdmin(true);
      return true;
    }

    // Fallback: Check user_roles table
    console.log('[AuthContext] Checking user_roles table for admin role...');
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', currentUser.id)
        .eq('role', 'admin')
        .maybeSingle();

      if (!error && data) {
        console.log('[AuthContext] Admin status confirmed via user_roles table:', currentUser.email);
        setIsAdmin(true);
        return true;
      }
    } catch (err) {
      console.error('[AuthContext] Error checking user_roles:', err);
    }

    console.log('[AuthContext] User is NOT an admin:', currentUser.email);
    setIsAdmin(false);
    return false;
  }, []);

  const handleSession = useCallback(async (session) => {
    console.log('[AuthContext] Session changed:', session?.user?.email || 'No user');
    
    setSession(session);
    setUser(session?.user ?? null);
    
    if (session?.user) {
      await checkAdminStatus(session.user);
    } else {
      setIsAdmin(false);
    }
    
    setLoading(false);
  }, [checkAdminStatus]);

  useEffect(() => {
    console.log('[AuthContext] Initializing auth state...');
    
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      await handleSession(session);
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[AuthContext] Auth state change event:', event);
        await handleSession(session);
      }
    );

    return () => {
      console.log('[AuthContext] Cleaning up auth subscription');
      subscription.unsubscribe();
    };
  }, [handleSession]);

  const signUp = useCallback(async (email, password, options) => {
    console.log('[AuthContext] Sign up attempt:', email);
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options,
    });

    if (error) {
      console.error('[AuthContext] Sign up error:', error.message);
      toast({
        variant: "destructive",
        title: "Sign up Failed",
        description: error.message || "Something went wrong",
      });
    } else {
      console.log('[AuthContext] Sign up successful:', email);
    }

    return { error };
  }, [toast]);

  const signIn = useCallback(async (email, password) => {
    console.log('[AuthContext] Sign in attempt:', email);
    
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('[AuthContext] Sign in error:', error.message);
      toast({
        variant: "destructive",
        title: "Sign in Failed",
        description: error.message || "Something went wrong",
      });
    } else {
      console.log('[AuthContext] Sign in successful:', email);
    }

    return { error };
  }, [toast]);

  const signOut = useCallback(async () => {
    console.log('[AuthContext] Sign out attempt');
    
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('[AuthContext] Sign out error:', error.message);
      toast({
        variant: "destructive",
        title: "Sign out Failed",
        description: error.message || "Something went wrong",
      });
    } else {
      console.log('[AuthContext] Sign out successful');
      setIsAdmin(false);
    }

    return { error };
  }, [toast]);

  const value = useMemo(() => ({
    user,
    session,
    loading,
    isAdmin,
    signUp,
    signIn,
    signOut,
  }), [user, session, loading, isAdmin, signUp, signIn, signOut]);

  console.log('[AuthContext] Current state:', {
    hasUser: !!user,
    userEmail: user?.email,
    isAdmin,
    loading,
  });

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export { AuthProvider as SupabaseAuthProvider };
