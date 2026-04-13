
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/hooks/use-toast';

const AuthContext = createContext(undefined);

// Helper to clear local storage tokens if they are corrupted
const clearLocalAuthData = () => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.error("Failed to clear auth local storage", e);
  }
};

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const handleSession = useCallback(async (sessionObj) => {
    console.log("[AuthContext] Handling session update:", sessionObj ? "Session found" : "No session");
    setSession(sessionObj);
    setUser(sessionObj?.user ?? null);
    
    const adminStatus = sessionObj?.user?.user_metadata?.is_admin === true;
    setIsAdmin(adminStatus);
    
    setLoading(false);
  }, []);

  const fetchSessionWithRetry = useCallback(async (retries = 2) => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        if (
          error.message.includes('refresh_token_not_found') || 
          error.message.includes('session_not_found') ||
          error.status === 400 || 
          error.status === 401
        ) {
          console.warn("[AuthContext] Invalid or expired session, clearing local data...");
          clearLocalAuthData();
          await supabase.auth.signOut();
          return null;
        }
        throw error;
      }
      return session;
    } catch (error) {
      console.error(`[AuthContext] Error fetching session (retries left: ${retries}):`, error);
      if (retries > 0) {
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
        return fetchSessionWithRetry(retries - 1);
      }
      
      // If all retries fail, clear and logout gracefully
      clearLocalAuthData();
      await supabase.auth.signOut().catch(() => {});
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      console.log("[AuthContext] Getting initial session...");
      const session = await fetchSessionWithRetry();
      if (mounted) {
        handleSession(session);
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, sessionObj) => {
        console.log(`[AuthContext] Auth state changed: ${event}`);
        
        if (event === 'SIGNED_OUT') {
          clearLocalAuthData();
        } else if (event === 'TOKEN_REFRESHED') {
          console.log("[AuthContext] Token successfully refreshed.");
        }

        if (mounted) {
          handleSession(sessionObj);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [handleSession, fetchSessionWithRetry]);

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
      console.log("[AuthContext] Sign in successful.");
    }

    return { error, data };
  }, [toast]);

  const signOut = useCallback(async () => {
    console.log("[AuthContext] Attempting sign out...");
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        if (
          error.message?.includes("Session from session_id claim in JWT does not exist") ||
          error.status === 401 ||
          error.status === 403 ||
          error.status === 404
        ) {
          console.warn("[AuthContext] Ignored sign out error (invalid session):", error.message);
        } else {
          console.error("[AuthContext] Sign out error:", error);
          toast({
            variant: "destructive",
            title: "Sign out Failed",
            description: error.message || "Something went wrong",
          });
        }
      }
    } catch (err) {
      console.warn("[AuthContext] Caught sign out exception:", err);
    } finally {
      clearLocalAuthData();
      setSession(null);
      setUser(null);
      setIsAdmin(false);
    }

    return { error: null };
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
