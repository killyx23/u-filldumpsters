import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/hooks/use-toast';

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const handleSession = useCallback(async (session) => {
    console.log("[AuthContext] Handling session update:", session ? "Session found" : "No session");
    setSession(session);
    setUser(session?.user ?? null);
    
    // Check if the user has the is_admin flag in their metadata
    const adminStatus = session?.user?.user_metadata?.is_admin === true;
    setIsAdmin(adminStatus);
    
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;

    const getSession = async () => {
      console.log("[AuthContext] Getting initial session...");
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error("[AuthContext] Error getting session:", error);
      }
      if (mounted) {
        handleSession(session);
      }
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log(`[AuthContext] Auth state changed: ${event}`);
        if (mounted) {
          handleSession(session);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [handleSession]);

  const signUp = useCallback(async (email, password, options) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Sign up Failed",
        description: error.message || "Something went wrong",
      });
    }

    return { error };
  }, [toast]);

  const signIn = useCallback(async (email, password) => {
    console.log("[AuthContext] Attempting sign in...");
    const { error, data } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("[AuthContext] Sign in error:", error);
      toast({
        variant: "destructive",
        title: "Sign in Failed",
        description: error.message || "Something went wrong",
      });
    } else {
      console.log("[AuthContext] Sign in successful, waiting for auth state change event...");
    }

    return { error, data };
  }, [toast]);

  const signOut = useCallback(async () => {
    console.log("[AuthContext] Attempting sign out...");
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("[AuthContext] Sign out error:", error);
      toast({
        variant: "destructive",
        title: "Sign out Failed",
        description: error.message || "Something went wrong",
      });
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};