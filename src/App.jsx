import React, { Suspense } from 'react';
import { Routes, Route, Outlet, Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Toaster } from '@/components/ui/toaster';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import BookingJourney from '@/pages/BookingJourney';
import AdminDashboard from '@/pages/AdminDashboard';
import BookingConfirmation from '@/pages/BookingConfirmation';
import { AuthProvider, useAuth } from '@/contexts/SupabaseAuthContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import CustomerDetailPage from '@/pages/CustomerDetailPage';
import ContactPage from '@/pages/ContactPage';
import FaqPage from '@/pages/FaqPage';
import AdminLogin from '@/pages/AdminLogin';
import AdminRouteGuard from '@/components/AdminRouteGuard';
import CustomerPortal from '@/pages/CustomerPortal';
import CustomerLogin from '@/pages/CustomerLogin';
import ReviewsPage from '@/pages/ReviewsPage';
import ReceiptPage from '@/pages/ReceiptPage';
import TestEmailPage from '@/pages/TestEmailPage';
import VerifyEmailPage from '@/pages/VerifyEmailPage';
import ProductShowcasePage from '@/pages/ProductShowcasePage';
import { CustomerPortalResourcesPage } from '@/components/customer-portal/CustomerPortalResourcesPage';
import { CustomerPortalResourceDetailPage } from '@/components/customer-portal/CustomerPortalResourceDetailPage';
import CustomerPortalBookingDetail from '@/pages/CustomerPortalBookingDetail';
import { CartProvider } from '@/hooks/useCart';
import AuthErrorBoundary from '@/components/AuthErrorBoundary';
import { Loader2 } from 'lucide-react';

// Loading fallback component
const AuthLoadingFallback = () => (
  <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 flex items-center justify-center">
    <div className="text-center space-y-4">
      <Loader2 className="h-12 w-12 text-yellow-400 animate-spin mx-auto" />
      <p className="text-white text-lg font-medium">Initializing authentication...</p>
      <p className="text-blue-200 text-sm">Please wait while we verify your session</p>
    </div>
  </div>
);

// Auth initialization wrapper
const AuthInitWrapper = ({ children }) => {
  const { loading } = useAuth();

  if (loading) {
    return <AuthLoadingFallback />;
  }

  return children;
};

// Admin Layout with the Guard
const AdminLayout = () => (
  <AdminRouteGuard>
    <Outlet />
  </AdminRouteGuard>
);

const CustomerPortalGuard = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return <AuthLoadingFallback />;
  }
  
  if (!user || user.user_metadata?.is_admin) {
    return <Navigate to="/login" replace />;
  }
  
  return <div className="container mx-auto py-8 px-4">{children}</div>;
};

const CustomerLayout = () => (
  <Outlet />
);

function AppContent() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 text-white relative flex flex-col">
      <Toaster />
      <Header />
      
      <main className="flex-grow">
        <AuthInitWrapper>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<BookingJourney />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/product-showcase" element={<ProductShowcasePage />} />
            
            {/* Protected Admin Routes */}
            <Route element={<AdminLayout />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/customer/:id" element={<CustomerDetailPage />} />
            </Route>

            {/* Customer Portal Routes */}
            <Route element={<CustomerLayout />}>
              <Route path="/portal" element={<CustomerPortal />} />
              <Route path="/login" element={<CustomerLogin />} />
              <Route path="/portal/bookings/:id" element={
                <CustomerPortalGuard>
                  <CustomerPortalBookingDetail />
                </CustomerPortalGuard>
              } />
              <Route path="/customer-portal/resources" element={
                <CustomerPortalGuard>
                  <CustomerPortalResourcesPage />
                </CustomerPortalGuard>
              } />
              <Route path="/customer-portal/resources/:id" element={
                <CustomerPortalGuard>
                  <CustomerPortalResourceDetailPage />
                </CustomerPortalGuard>
              } />
            </Route>

            {/* Other Public Routes */}
            <Route path="/confirmation" element={<BookingConfirmation />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/receipt" element={<ReceiptPage />} />
            <Route path="/verify" element={<VerifyEmailPage />} />
            <Route path="/test-email" element={<TestEmailPage />} />
          </Routes>
        </AuthInitWrapper>
      </main>

      <Footer />
    </div>
  );
}

function App() {
  return (
    <AuthErrorBoundary>
      <Suspense fallback={<AuthLoadingFallback />}>
        <AuthProvider>
          <CartProvider>
            <TooltipProvider>
              <Helmet>
                <title>U-Fill Dumpsters LLC - Fast, Reliable Waste Solutions</title>
                <meta name="description" content="Professional dumpster rental services with same-day delivery. Choose from our rental options for your home or business projects. Book online today!" />
              </Helmet>
              <AppContent />
            </TooltipProvider>
          </CartProvider>
        </AuthProvider>
      </Suspense>
    </AuthErrorBoundary>
  );
}

export default App;