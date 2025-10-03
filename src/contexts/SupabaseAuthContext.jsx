
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
    
      const handleSession = useCallback(async (session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setIsAdmin(session?.user?.user_metadata?.is_admin || false);
        setLoading(false);
      }, []);
    
      const setManualSession = useCallback(async (sessionData) => {
        setLoading(true);
        const { data, error } = await supabase.auth.setSession(sessionData);
        if (error) {
          toast({ title: "Session Error", description: error.message, variant: "destructive" });
          setLoading(false);
          return;
        }
        if (data.session) {
          handleSession(data.session);
        } else {
          setLoading(false);
        }
      }, [toast, handleSession]);
    
      useEffect(() => {
        const getSession = async () => {
          const { data: { session } } = await supabase.auth.getSession();
          handleSession(session);
        };
    
        getSession();
    
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          (event, session) => {
            handleSession(session);
          }
        );
    
        return () => subscription.unsubscribe();
      }, [handleSession]);
    
      const signOut = useCallback(async () => {
        setLoading(true);
        const { error } = await supabase.auth.signOut();
        
        setUser(null);
        setSession(null);
        setIsAdmin(false);
    
        if (error && error.code !== '403' && error.message !== 'Session from session_id claim in JWT does not exist') {
          toast({ title: "Sign Out Error", description: error.message, variant: "destructive" });
        }
        
        setLoading(false);
        // Force a redirect to the login page to ensure a clean state.
        window.location.href = '/login';
      }, [toast]);
    
      const value = useMemo(() => ({
        user,
        session,
        isAdmin,
        loading,
        signOut,
        setManualSession,
      }), [user, session, isAdmin, loading, signOut, setManualSession]);
    
      return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
    };
    
    export const useAuth = () => {
      const context = useContext(AuthContext);
      if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
      }
      return context;
    };
  