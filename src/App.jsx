import React from 'react';
import { Routes, Route, Outlet } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Toaster } from '@/components/ui/toaster';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import BookingJourney from '@/pages/BookingJourney';
import AdminDashboard from '@/pages/AdminDashboard';
import BookingConfirmation from '@/pages/BookingConfirmation';
import { AuthProvider } from '@/contexts/SupabaseAuthContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import CustomerDetailPage from '@/pages/CustomerDetailPage';
import ContactPage from '@/pages/ContactPage';
import FaqPage from '@/pages/FaqPage';
import AdminLogin from '@/pages/AdminLogin';
import AdminRouteGuard from '@/components/AdminRouteGuard';
import CustomerPortal from '@/pages/CustomerPortal';
import CustomerLogin from '@/pages/CustomerLogin';

const AdminLayout = () => (
  <AdminRouteGuard>
    <Outlet />
  </AdminRouteGuard>
);

const CustomerLayout = () => (
    <Outlet />
);

function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <Helmet>
          <title>Premium Dumpster Rentals - Fast, Reliable Waste Solutions</title>
          <meta name="description" content="Professional dumpster rental services with same-day delivery. Choose from our rental options for your home or business projects. Book online today!" />
        </Helmet>

        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-900 text-white relative">
          <Toaster />
          <Header />
          
          <main className="min-h-[calc(100vh-120px)]">
              <Routes>
                  <Route path="/" element={<BookingJourney />} />
                  <Route path="/admin/login" element={<AdminLogin />} />
                  
                  <Route element={<AdminLayout />}>
                    <Route path="/admin" element={<AdminDashboard />} />
                    <Route path="/admin/customer/:id" element={<CustomerDetailPage />} />
                  </Route>

                  <Route element={<CustomerLayout />}>
                    <Route path="/portal" element={<CustomerPortal />} />
                    <Route path="/login" element={<CustomerLogin />} />
                  </Route>

                  <Route path="/confirmation" element={<BookingConfirmation />} />
                  <Route path="/contact" element={<ContactPage />} />
                  <Route path="/faq" element={<FaqPage />} />
              </Routes>
          </main>

          <Footer />

        </div>
      </TooltipProvider>
    </AuthProvider>
  );
}

export default App;