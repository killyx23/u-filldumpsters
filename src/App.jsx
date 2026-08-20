
import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import BookingJourney from '@/pages/BookingJourney';
import { FaqPage } from '@/pages/FaqPage';
import { ReviewsPage } from '@/pages/ReviewsPage';
import { ContactPage } from '@/pages/ContactPage';
import { AboutPage } from '@/pages/AboutPage';
import { AdminDashboard } from '@/pages/AdminDashboard';
import { AdminLogin } from '@/pages/AdminLogin';
import { CustomerDetailView } from '@/components/admin/customer-detail/CustomerDetailView';
import { AdminRouteGuard } from '@/components/AdminRouteGuard';
import { SupabaseAuthProvider } from '@/contexts/SupabaseAuthContext';
import { BookingFlowProvider } from '@/contexts/BookingFlowContext';
import { CustomerPortalLogin } from '@/pages/CustomerPortalLogin';
import { CustomerLogin } from '@/pages/CustomerLogin';
import { CustomerPortal } from '@/pages/CustomerPortal';
import { Toaster } from '@/components/ui/toaster';
import { ResourceLibraryPage } from '@/pages/ResourceLibraryPage';
import { ResourceDetailPage } from '@/pages/ResourceDetailPage';
import { BookingConfirmation } from '@/pages/BookingConfirmation';
import { ReceiptPage } from '@/pages/ReceiptPage';
import { ProductShowcasePage } from '@/pages/ProductShowcasePage';
import AccessCodesPage from '@/pages/AccessCodesPage';
import LockLifecycleTestPage from '@/pages/LockLifecycleTestPage';
import { VerifyEmailPage } from '@/pages/VerifyEmailPage';
import { PaymentPage } from '@/pages/PaymentPage';
import CustomerPortalBookingDetail from '@/pages/CustomerPortalBookingDetail';
import { CustomerPortalGuard } from '@/components/customer-portal/CustomerPortalGuard';
import { CustomerPortalResourceDetailPage } from '@/components/customer-portal/CustomerPortalResourceDetailPage';
import { ScrollToTop } from '@/components/ScrollToTop';

const mergeRouteQuery = (to, incomingSearch) => {
  const [path, toQuery = ''] = to.split('?');
  const merged = new URLSearchParams(toQuery);
  const incoming = new URLSearchParams(incomingSearch);

  incoming.forEach((value, key) => {
    merged.set(key, value);
  });

  const query = merged.toString();
  return `${path}${query ? `?${query}` : ''}`;
};

const PortalRedirect = ({ to }) => {
  const { search } = useLocation();
  return <Navigate to={mergeRouteQuery(to, search)} replace />;
};

/** Legacy receipt QR paths: /portal/access-codes?token=... → customer portal access tab */
const PortalAccessCodesRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={mergeRouteQuery('/customer-portal?tab=access-codes', search)} replace />;
};

const VerifyRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={`/verify-email${search}`} replace />;
};

function App() {
  const [reorderData, setReorderData] = useState(null);

  const handleReorderSelect = (bookingData) => {
    setReorderData(bookingData);
  };

  return (
    <SupabaseAuthProvider>
      <Router>
        <ScrollToTop />
        <BookingFlowProvider>
        <Helmet>
          <title>Dumpster Rental | Book Online Today</title>
          <meta name="description" content="Professional dumpster rental for residential and commercial projects. Easy online booking, competitive rates, and reliable service." />
        </Helmet>
        
        <div className="flex flex-col min-h-screen text-white">
          <Header onReorderSelect={handleReorderSelect} />
          <main className="flex-grow">
            <Routes>
              <Route
                path="/"
                element={
                  <BookingJourney
                    reorderData={reorderData}
                    onReorderApplied={() => setReorderData(null)}
                  />
                }
              />
              <Route path="/faqs" element={<FaqPage />} />
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/admin-login" element={<AdminLogin />} />
              <Route path="/customer-login" element={<CustomerLogin />} />
              <Route path="/login" element={<CustomerLogin />} />
              <Route path="/customer-portal-login" element={<CustomerPortalLogin />} />
              <Route path="/booking-confirmation" element={<BookingConfirmation />} />
              <Route path="/receipt/:bookingId" element={<ReceiptPage />} />
              <Route path="/products" element={<ProductShowcasePage />} />
              <Route path="/verify" element={<VerifyRedirect />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/payment" element={<PaymentPage />} />
              <Route path="/confirmation" element={<BookingConfirmation />} />
              
              <Route path="/resources" element={<ResourceLibraryPage />} />
              <Route path="/resources/:id" element={<ResourceDetailPage />} />
              
              <Route path="/customer-portal" element={<CustomerPortal />} />
              <Route path="/portal" element={<PortalRedirect to="/customer-portal" />} />
              <Route path="/portal/access-codes" element={<PortalAccessCodesRedirect />} />
              <Route path="/customer-portal/resources" element={<PortalRedirect to="/customer-portal?tab=resources" />} />
              
              {/* Backward compatibility routes */}
              <Route path="/customer-portal/dashboard" element={<PortalRedirect to="/customer-portal" />} />
              <Route path="/customer-portal/login" element={<PortalRedirect to="/customer-portal-login" />} />

              <Route
                path="/customer-portal/resources/:id"
                element={
                  <CustomerPortalGuard>
                    <CustomerPortalResourceDetailPage />
                  </CustomerPortalGuard>
                }
              />

              <Route
                path="/portal/bookings/:id"
                element={
                  <CustomerPortalGuard>
                    <CustomerPortalBookingDetail />
                  </CustomerPortalGuard>
                }
              />

              <Route
                path="/admin"
                element={
                  <AdminRouteGuard>
                    <Outlet />
                  </AdminRouteGuard>
                }
              >
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="customer/:customerId" element={<CustomerDetailView />} />
                <Route path="access-codes" element={<AccessCodesPage />} />
                <Route path="lock-test" element={<LockLifecycleTestPage />} />
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="*" element={<Navigate to="dashboard" replace />} />
              </Route>
              
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <Footer />
          <Toaster />
        </div>
        </BookingFlowProvider>
      </Router>
    </SupabaseAuthProvider>
  );
}

export default App;
