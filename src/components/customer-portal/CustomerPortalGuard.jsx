import React from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';

export const CustomerPortalGuard = ({ children }) => {
  const { user, session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
      </div>
    );
  }

  if (!user || !session) {
    return <Navigate to="/customer-portal" replace />;
  }

  return <div className="container mx-auto py-8 px-4">{children}</div>;
};
