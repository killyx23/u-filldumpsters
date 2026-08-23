
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { parseJwtAal } from '@/lib/adminMfa';

const AuthContext = createContext(undefined);

const emptyMfa = {
  currentAal: 'aal1',
  needsMfaEnrollment: false,
  needsMfaChallenge: false,
};

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentAal, setCurrentAal] = useState('aal1');
  const [needsMfaEnrollment, setNeedsMfaEnrollment] = useState(false);
  const [needsMfaChallenge, setNeedsMfaChallenge] = useState(false);
  const [mfaReady, setMfaReady] = useState(false);

  const applyMfaState = useCallback((next) => {
    setCurrentAal(next.currentAal);
    setNeedsMfaEnrollment(next.needsMfaEnrollment);
    setNeedsMfaChallenge(next.needsMfaChallenge);
  }, []);

  // Check if user has admin privileges
  const checkAdminStatus = useCallback(async (currentUser) => {
    if (!currentUser) {
      setIsAdmin(false);
      return false;
    }

    if (currentUser.app_metadata?.is_admin === true) {
      console.log('[AuthContext] Admin status confirmed via app_metadata:', currentUser.email);
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

  const refreshMfa = useCallback(async (activeSession, adminFlag) => {
    if (!activeSession?.user || !adminFlag) {
      applyMfaState({
        ...emptyMfa,
        currentAal: parseJwtAal(activeSession?.access_token),
      });
      return emptyMfa;
    }

    const aal = parseJwtAal(activeSession.access_token);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        console.error('[AuthContext] listFactors error:', error);
        const fallback = {
          currentAal: aal,
          needsMfaEnrollment: false,
          needsMfaChallenge: aal !== 'aal2',
        };
        applyMfaState(fallback);
        return fallback;
      }

      const hasVerifiedTotp = (data?.totp ?? []).some((factor) => factor.status === 'verified');
      const next = {
        currentAal: aal,
        needsMfaEnrollment: !hasVerifiedTotp,
        needsMfaChallenge: hasVerifiedTotp && aal !== 'aal2',
      };
      applyMfaState(next);
      return next;
    } catch (err) {
      console.error('[AuthContext] MFA refresh failed:', err);
      const fallback = {
        currentAal: aal,
        needsMfaEnrollment: false,
        needsMfaChallenge: aal !== 'aal2',
      };
      applyMfaState(fallback);
      return fallback;
    }
  }, [applyMfaState]);

  const handleSession = useCallback(async (nextSession) => {
    console.log('[AuthContext] Session changed:', nextSession?.user?.email || 'No user');

    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (!nextSession?.user) {
      setIsAdmin(false);
      applyMfaState(emptyMfa);
      setMfaReady(true);
      setLoading(false);
      return;
    }

    setMfaReady(false);
    const admin = await checkAdminStatus(nextSession.user);
    await refreshMfa(nextSession, admin);
    setMfaReady(true);
    setLoading(false);
  }, [checkAdminStatus, refreshMfa, applyMfaState]);

  useEffect(() => {
    console.log('[AuthContext] Initializing auth state...');

    const getSession = async () => {
      const { data: { session: initialSession } } = await supabase.auth.getSession();
      await handleSession(initialSession);
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        console.log('[AuthContext] Auth state change event:', event);
        // Defer so MFA/session APIs are not called inside the auth callback (supabase-js deadlock).
        setTimeout(() => {
          handleSession(nextSession);
        }, 0);
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
      applyMfaState(emptyMfa);
      setMfaReady(true);
    }

    return { error };
  }, [toast, applyMfaState]);

  const value = useMemo(() => ({
    user,
    session,
    loading,
    isAdmin,
    currentAal,
    needsMfaEnrollment,
    needsMfaChallenge,
    mfaReady,
    refreshMfa: async () => {
      const { data: { session: latest } } = await supabase.auth.getSession();
      const admin = latest?.user?.app_metadata?.is_admin === true || isAdmin;
      return refreshMfa(latest, admin);
    },
    signUp,
    signIn,
    signOut,
  }), [
    user,
    session,
    loading,
    isAdmin,
    currentAal,
    needsMfaEnrollment,
    needsMfaChallenge,
    mfaReady,
    refreshMfa,
    signUp,
    signIn,
    signOut,
  ]);

  console.log('[AuthContext] Current state:', {
    hasUser: !!user,
    userEmail: user?.email,
    isAdmin,
    currentAal,
    needsMfaEnrollment,
    needsMfaChallenge,
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
