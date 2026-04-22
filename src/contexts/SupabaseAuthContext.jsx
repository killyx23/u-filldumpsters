import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/hooks/use-toast';

const AuthContext = createContext(undefined);

// Enhanced debug logger with colored output
const authLog = (label, data, level = 'info') => {
  const colors = {
    info: 'background:#059669;color:#fff',
    warn: 'background:#f59e0b;color:#000',
    error: 'background:#dc2626;color:#fff',
    token: 'background:#8b5cf6;color:#fff'
  };
  
  console.log(
    `%c[AuthContext] ${label}`,
    `${colors[level]};font-weight:bold;padding:2px 6px;border-radius:3px`,
    data ?? ''
  );
};

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Track redirect to prevent infinite loops
  const isRedirecting = useRef(false);
  const hasShownSessionExpiredToast = useRef(false);

  // Clear all auth-related localStorage items
  const clearAuthStorage = useCallback(() => {
    authLog('Clearing all auth storage', null, 'warn');
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('supabase') || key.includes('sb-'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => {
        authLog(`Removing localStorage key: ${key}`, null, 'token');
        localStorage.removeItem(key);
      });
      authLog('Auth storage cleared successfully', { clearedKeys: keysToRemove.length }, 'warn');
    } catch (err) {
      authLog('Failed to clear auth storage', err.message, 'error');
    }
  }, []);

  // Handle session expiration
  const handleSessionExpired = useCallback(() => {
    if (isRedirecting.current) {
      authLog('Already redirecting, skipping duplicate session expiry handling', null, 'warn');
      return;
    }

    authLog('Handling session expiration', null, 'warn');
    isRedirecting.current = true;

    // Clear all auth state
    setSession(null);
    setUser(null);
    setIsAdmin(false);
    setLoading(false);

    // Clear storage
    clearAuthStorage();

    // Show toast only once
    if (!hasShownSessionExpiredToast.current) {
      hasShownSessionExpiredToast.current = true;
      toast({
        variant: "destructive",
        title: "Session Expired",
        description: "Your session has expired. Please log in again.",
        duration: 5000,
      });
    }

    // Redirect based on current path
    const currentPath = window.location.pathname;
    const isAdminRoute = currentPath.startsWith('/admin');

    authLog('Redirecting to login', { 
      currentPath, 
      isAdminRoute,
      targetPath: isAdminRoute ? '/admin/login' : '/login' 
    }, 'warn');

    // Small delay to ensure state is updated
    setTimeout(() => {
      if (isAdminRoute) {
        window.location.href = '/admin/login';
      } else if (currentPath.startsWith('/portal')) {
        window.location.href = '/login';
      }
      // For public routes, just clear state without redirect
    }, 100);
  }, [clearAuthStorage, toast]);

  // Validate token before operations
  const validateToken = useCallback((sessionData) => {
    if (!sessionData) {
      authLog('Token validation failed: no session', null, 'warn');
      return false;
    }

    if (!sessionData.access_token) {
      authLog('Token validation failed: no access_token', null, 'warn');
      return false;
    }

    // Check if token is expired
    if (sessionData.expires_at) {
      const expiresAt = sessionData.expires_at * 1000; // Convert to milliseconds
      const now = Date.now();
      const isExpired = expiresAt < now;
      
      authLog('Token expiration check', {
        expiresAt: new Date(expiresAt).toISOString(),
        now: new Date(now).toISOString(),
        isExpired
      }, isExpired ? 'warn' : 'token');

      if (isExpired) {
        return false;
      }
    }

    authLog('Token validation passed', { hasRefreshToken: !!sessionData.refresh_token }, 'token');
    return true;
  }, []);

  // Extract isAdmin from user object with fallback logic
  const extractIsAdmin = useCallback((userData) => {
    if (!userData) {
      authLog('extractIsAdmin: No user data', null);
      return false;
    }

    authLog('extractIsAdmin: Full user object', {
      id: userData.id,
      email: userData.email,
      app_metadata: userData.app_metadata,
      user_metadata: userData.user_metadata,
    });

    // Priority 1: Check app_metadata.is_admin (server-controlled)
    if (userData.app_metadata && typeof userData.app_metadata.is_admin !== 'undefined') {
      const adminFlag = Boolean(userData.app_metadata.is_admin);
      authLog('extractIsAdmin: Found in app_metadata', {
        raw_value: userData.app_metadata.is_admin,
        boolean_value: adminFlag,
      });
      return adminFlag;
    }

    // Priority 2: Check user_metadata.is_admin (user-controlled, less reliable)
    if (userData.user_metadata && typeof userData.user_metadata.is_admin !== 'undefined') {
      const adminFlag = Boolean(userData.user_metadata.is_admin);
      authLog('extractIsAdmin: Found in user_metadata', {
        raw_value: userData.user_metadata.is_admin,
        boolean_value: adminFlag,
      });
      return adminFlag;
    }

    // Priority 3: Check raw_app_meta_data (alternative field name)
    if (userData.raw_app_meta_data && typeof userData.raw_app_meta_data.is_admin !== 'undefined') {
      const adminFlag = Boolean(userData.raw_app_meta_data.is_admin);
      authLog('extractIsAdmin: Found in raw_app_meta_data', {
        raw_value: userData.raw_app_meta_data.is_admin,
        boolean_value: adminFlag,
      });
      return adminFlag;
    }

    // Priority 4: Check raw_user_meta_data (alternative field name)
    if (userData.raw_user_meta_data && typeof userData.raw_user_meta_data.is_admin !== 'undefined') {
      const adminFlag = Boolean(userData.raw_user_meta_data.is_admin);
      authLog('extractIsAdmin: Found in raw_user_meta_data', {
        raw_value: userData.raw_user_meta_data.is_admin,
        boolean_value: adminFlag,
      });
      return adminFlag;
    }

    authLog('extractIsAdmin: No is_admin flag found anywhere', {
      checked_fields: ['app_metadata', 'user_metadata', 'raw_app_meta_data', 'raw_user_meta_data'],
    });
    return false;
  }, []);

  const handleSession = useCallback(async (newSession) => {
    authLog('handleSession called', {
      has_session: !!newSession,
      user_email: newSession?.user?.email || 'none',
    });

    try {
      // Validate token if session exists
      if (newSession && !validateToken(newSession)) {
        authLog('Session token validation failed', null, 'error');
        handleSessionExpired();
        return;
      }

      setSession(newSession);
      const userData = newSession?.user ?? null;
      setUser(userData);

      if (userData) {
        const adminStatus = extractIsAdmin(userData);
        setIsAdmin(adminStatus);
        
        authLog('Auth state updated', {
          email: userData.email,
          isAdmin: adminStatus,
          userId: userData.id,
        });

        // Reset redirect flag on successful auth
        isRedirecting.current = false;
        hasShownSessionExpiredToast.current = false;

        // Verify admin flag is accessible
        if (!adminStatus) {
          authLog('⚠️ WARNING: User logged in but isAdmin is false', {
            email: userData.email,
            message: 'Check if is_admin flag is set in Supabase auth.users table',
          }, 'warn');
        }
      } else {
        setIsAdmin(false);
        authLog('No user - cleared admin status', null);
      }
    } catch (err) {
      authLog('❌ Error in handleSession', err.message, 'error');
      setIsAdmin(false);
      
      // Check if it's a token error
      if (err.message?.includes('refresh_token') || err.message?.includes('session')) {
        handleSessionExpired();
      }
    } finally {
      setLoading(false);
    }
  }, [extractIsAdmin, validateToken, handleSessionExpired]);

  useEffect(() => {
    authLog('AuthProvider mounted - initializing auth', null);

    const getSession = async () => {
      try {
        authLog('Fetching initial session...', null);
        
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();
        
        if (error) {
          authLog('❌ Error fetching session', error.message, 'error');
          
          // Check for token-related errors
          if (error.message?.includes('refresh_token_not_found') || 
              error.message?.includes('invalid_grant') ||
              error.message?.includes('session_not_found')) {
            authLog('Token error detected - handling session expiry', null, 'error');
            handleSessionExpired();
            return;
          }
          
          throw error;
        }

        authLog('Initial session fetched', {
          has_session: !!initialSession,
          user_email: initialSession?.user?.email || 'none',
        });

        await handleSession(initialSession);
      } catch (err) {
        authLog('❌ Fatal error getting session', err.message, 'error');
        setLoading(false);
        
        // Check if it's a recoverable error
        const isTokenError = 
          err.message?.includes('refresh_token') ||
          err.message?.includes('invalid_grant') ||
          err.message?.includes('session');

        if (isTokenError) {
          handleSessionExpired();
        } else {
          toast({
            variant: "destructive",
            title: "Authentication Error",
            description: "Failed to verify authentication status. Please refresh the page.",
          });
        }
      }
    };

    getSession();

    authLog('Setting up auth state change listener', null);
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        authLog('Auth state changed', {
          event: event,
          has_session: !!session,
          user_email: session?.user?.email || 'none',
        });

        // Handle specific auth events
        if (event === 'TOKEN_REFRESHED') {
          authLog('Token refreshed successfully', null, 'token');
        } else if (event === 'SIGNED_OUT') {
          authLog('User signed out', null);
          clearAuthStorage();
        } else if (event === 'USER_UPDATED') {
          authLog('User updated', null);
        }

        await handleSession(session);
      }
    );

    // Monitor for token refresh errors
    const tokenErrorHandler = (event) => {
      if (event.detail?.message?.includes('refresh_token')) {
        authLog('Token refresh error caught by event listener', event.detail, 'error');
        handleSessionExpired();
      }
    };

    window.addEventListener('supabase:auth:error', tokenErrorHandler);

    return () => {
      authLog('AuthProvider unmounting - cleaning up', null);
      subscription.unsubscribe();
      window.removeEventListener('supabase:auth:error', tokenErrorHandler);
    };
  }, [handleSession, handleSessionExpired, clearAuthStorage, toast]);

  const signUp = useCallback(async (email, password, options) => {
    authLog('signUp called', { email });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options,
      });

      if (error) {
        authLog('❌ Sign up error', error.message, 'error');
        toast({
          variant: "destructive",
          title: "Sign up Failed",
          description: error.message || "Something went wrong",
        });
        return { error };
      }

      authLog('✅ Sign up successful', { email });
      return { data, error: null };
    } catch (err) {
      authLog('❌ Unexpected sign up error', err.message, 'error');
      toast({
        variant: "destructive",
        title: "Sign up Error",
        description: "An unexpected error occurred during sign up.",
      });
      return { error: err };
    }
  }, [toast]);

  const signIn = useCallback(async (email, password) => {
    authLog('signIn called', { email });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        authLog('❌ Sign in error', error.message, 'error');
        
        // Check for token-related errors
        if (error.message?.includes('refresh_token') || error.message?.includes('invalid_grant')) {
          clearAuthStorage();
        }
        
        toast({
          variant: "destructive",
          title: "Sign in Failed",
          description: error.message || "Something went wrong",
        });
        return { error };
      }

      authLog('✅ Sign in successful', {
        email: data.user?.email,
        has_session: !!data.session,
      });

      return { data, error: null };
    } catch (err) {
      authLog('❌ Unexpected sign in error', err.message, 'error');
      
      // Check for token errors in catch
      if (err.message?.includes('refresh_token') || err.message?.includes('session')) {
        clearAuthStorage();
      }
      
      toast({
        variant: "destructive",
        title: "Sign in Error",
        description: "An unexpected error occurred during sign in.",
      });
      return { error: err };
    }
  }, [toast, clearAuthStorage]);

  const signOut = useCallback(async () => {
    authLog('signOut called', { current_user: user?.email || 'none' });
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        const isSessionNotFound = error.status === 403 && error.code === 'session_not_found';
        
        if (!isSessionNotFound) {
          authLog('❌ Sign out error (non-session)', error.message, 'error');
          toast({
            variant: "destructive",
            title: "Sign out Failed",
            description: error.message || "Something went wrong",
          });
          return { error };
        }
        authLog('Sign out: session already expired', null, 'warn');
      }

      // Clear auth state
      setSession(null);
      setUser(null);
      setIsAdmin(false);
      clearAuthStorage();

      authLog('✅ Sign out successful - state cleared', null);

      toast({
        title: "Logged out successfully",
        description: "You have been signed out of your account.",
      });

      window.location.href = '/';
      return { error: null };
    } catch (err) {
      authLog('❌ Unexpected sign out error', err.message, 'error');
      
      // Still clear local state
      setSession(null);
      setUser(null);
      setIsAdmin(false);
      clearAuthStorage();

      toast({
        variant: "destructive",
        title: "Sign out Error",
        description: "An unexpected error occurred during logout.",
      });

      return { error: err };
    }
  }, [toast, user, clearAuthStorage]);

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