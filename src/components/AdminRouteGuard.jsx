import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Loader2 } from 'lucide-react';

const AdminRouteGuard = ({ children }) => {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    console.log("[AdminRouteGuard] Checking authentication state...");
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900">
        <Loader2 className="h-16 w-16 animate-spin text-yellow-400 mb-4" />
        <p className="text-white text-lg">Verifying access...</p>
      </div>
    );
  }

  if (!user) {
    console.warn("[AdminRouteGuard] No user found. Redirecting to /admin/login.");
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  if (!isAdmin) {
    console.warn(`[AdminRouteGuard] User ${user.email} is not an admin. Redirecting to /admin/login.`);
    return <Navigate to="/admin/login" state={{ from: location, error: 'unauthorized' }} replace />;
  }

  console.log("[AdminRouteGuard] Access granted. Rendering admin route.");
  return children;
};

export default AdminRouteGuard;