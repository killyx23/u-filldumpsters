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
      const { data, error } = await supabase.functions.invoke('customer-portal-login', {
        body: { customerId, phone },
      });

      if (error || (data && data.error)) {
        const errorMessage = (data && data.error) || error.message || 'An unexpected error occurred.';
        toast({
          variant: "destructive",
          title: "Login Failed",
          description: errorMessage,
        });
        return { error: errorMessage };
      }
      
      if (data.session) {
        const { error: sessionError } = await supabase.auth.setSession(data.session);
        if(sessionError) {
          toast({ variant: "destructive", title: "Login Failed", description: "Could not establish a session." });
        } else {
          toast({ title: "Login Successful", description: "Redirecting to your portal..." });
        }
      } else {
         toast({ variant: "destructive", title: "Login Failed", description: "Could not establish a session." });
      }
      return { data };
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