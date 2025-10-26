import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
    import { supabase } from '@/lib/customSupabaseClient';
    import { useNavigate } from 'react-router-dom';

    const AuthContext = createContext(undefined);

    export const AuthProvider = ({ children }) => {
      const navigate = useNavigate();
      const [user, setUser] = useState(null);
      const [session, setSession] = useState(null);
      const [loading, setLoading] = useState(true);
      const [isAdmin, setIsAdmin] = useState(false);

      const handleSession = useCallback(async (currentSession) => {
        setSession(currentSession);
        const currentUser = currentSession?.user ?? null;
        
        if (currentUser) {
          setUser(currentUser);
          const isAdminStatus = currentUser.user_metadata?.is_admin || false;
          setIsAdmin(isAdminStatus);

          if (!currentUser.user_metadata?.customer_db_id) {
            const { data: customer, error } = await supabase
              .from('customers')
              .select('id')
              .eq('user_id', currentUser.id)
              .single();

            if (customer && !error) {
              const { data: { user: updatedUser }, error: updateUserError } = await supabase.auth.updateUser({
                data: { ...currentUser.user_metadata, customer_db_id: customer.id }
              });
              if (updateUserError) {
                console.error("Failed to update user metadata:", updateUserError);
              } else if (updatedUser) {
                setUser(updatedUser);
              }
            }
          }
        } else {
          setUser(null);
          setIsAdmin(false);
        }
        setLoading(false);
      }, []);

      useEffect(() => {
        const getInitialSession = async () => {
          const { data: { session: initialSession } } = await supabase.auth.getSession();
          await handleSession(initialSession);
        };

        getInitialSession();

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (_event, session) => {
            await handleSession(session);
          }
        );

        return () => {
          subscription.unsubscribe();
        };
      }, [handleSession]);

      const signOut = useCallback(async () => {
        setLoading(true);
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.error("Sign out error:", error);
        }
        // Force state update regardless of session change event
        setUser(null);
        setSession(null);
        setIsAdmin(false);
        
        // This is a bit of a hack to ensure we clear any other sessions
        // A more robust solution might involve custom logic with multiple storage keys
        // But for this use-case, this should prevent logout loops.
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sb-')) {
                localStorage.removeItem(key);
            }
        });

        navigate('/login', { replace: true });
        setLoading(false);
      }, [navigate]);

      const value = useMemo(() => ({
        user,
        session,
        isAdmin,
        loading,
        signOut,
      }), [user, session, isAdmin, loading, signOut]);

      return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
    };

    export const useAuth = () => {
      const context = useContext(AuthContext);
      if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
      }
      return context;
    };