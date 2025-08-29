import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleSession = useCallback((session) => {
    setSession(session);
    setUser(session?.user ?? null);
    setLoading(false);
  }, []);

  const getSessionAndValidate = useCallback(async () => {
    const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error("Error fetching session:", sessionError);
      handleSession(null);
      return;
    }

    if (initialSession) {
      const { data: { user: authedUser }, error } = await supabase.auth.getUser();
      if (error) {
        console.error("Invalid session detected, signing out.", error);
        await supabase.auth.signOut();
        handleSession(null);
      } else {
        handleSession({ ...initialSession, user: authedUser });
      }
    } else {
      handleSession(null);
    }
  }, [handleSession]);

  useEffect(() => {
    setLoading(true);
    getSessionAndValidate();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        handleSession(session);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [getSessionAndValidate]);

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
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Sign in Failed",
        description: error.message || "Something went wrong",
      });
    }

    return { error };
  }, [toast]);
  
  const customerPortalLogin = useCallback(async (customerId, phone) => {
      const { data, error: functionError } = await supabase.functions.invoke('customer-portal-login', {
        body: { customerId, phone },
      });

      if (functionError) {
        let errorMessage = "Login failed. Please try again.";
        try {
          const contextError = await functionError.context.json();
          if (contextError.error) {
            errorMessage = contextError.error;
          }
        } catch (e) {
          // Ignore if context is not valid JSON
        }
        toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
        return { error: errorMessage };
      }

      if (data && data.session) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (sessionError) {
          toast({ variant: "destructive", title: "Login Failed", description: "Could not establish a secure session." });
          return { error: sessionError };
        }
        toast({ title: "Login Successful", description: "Redirecting to your portal..." });
        return { data };
      } else {
        const errorMessage = (data && data.error) || "An unknown error occurred during login.";
        toast({ variant: "destructive", title: "Login Failed", description: errorMessage });
        return { error: errorMessage };
      }
  }, [toast]);


  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
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
    signUp,
    signIn,
    customerPortalLogin,
    signOut,
  }), [user, session, loading, signUp, signIn, customerPortalLogin, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};