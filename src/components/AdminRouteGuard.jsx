
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Loader2 } from 'lucide-react';

const AdminRouteGuard = ({ children }) => {
  const { user, loading, isAdmin, currentAal, mfaReady } = useAuth();
  const location = useLocation();

  console.log('[AdminRouteGuard] Checking access:', {
    hasUser: !!user,
    userEmail: user?.email,
    isAdmin,
    currentAal,
    loading,
    mfaReady,
    path: location.pathname,
  });

  if (loading || (user && isAdmin && !mfaReady)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900">
        <Loader2 className="h-16 w-16 animate-spin text-yellow-400 mb-4" />
        <p className="text-white text-lg">Verifying access...</p>
      </div>
    );
  }

  if (!user) {
    console.warn('[AdminRouteGuard] No user found - redirecting to /admin-login');
    return <Navigate to="/admin-login" state={{ from: location }} replace />;
  }

  if (!isAdmin) {
    console.warn('[AdminRouteGuard] User is not admin - redirecting to /admin-login');
    return (
      <Navigate
        to="/admin-login"
        state={{
          from: location,
          error: 'unauthorized',
          userEmail: user.email
        }}
        replace
      />
    );
  }

  if (currentAal !== 'aal2') {
    console.warn('[AdminRouteGuard] Admin MFA required - redirecting to /admin-mfa');
    return <Navigate to="/admin-mfa" state={{ from: location }} replace />;
  }

  console.log('[AdminRouteGuard] ✅ Access granted to admin user:', user.email);
  return children;
};

export default AdminRouteGuard;
export { AdminRouteGuard };
