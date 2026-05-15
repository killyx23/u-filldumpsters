
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Loader2, AlertCircle, Lock } from 'lucide-react';

const AdminRouteGuard = ({ children }) => {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  console.log('[AdminRouteGuard] Checking access:', {
    hasUser: !!user,
    userEmail: user?.email,
    isAdmin,
    loading,
    path: location.pathname,
  });

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900">
        <Loader2 className="h-16 w-16 animate-spin text-yellow-400 mb-4" />
        <p className="text-white text-lg">Verifying access...</p>
      </div>
    );
  }

  // Redirect to login if no user
  if (!user) {
    console.warn('[AdminRouteGuard] No user found - redirecting to /admin-login');
    return <Navigate to="/admin-login" state={{ from: location }} replace />;
  }

  // Redirect to login if user is not admin
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

  // Grant access to admin user
  console.log('[AdminRouteGuard] ✅ Access granted to admin user:', user.email);
  return children;
};

export default AdminRouteGuard;
export { AdminRouteGuard };
