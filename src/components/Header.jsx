
import React, { useState } from 'react';
import { LogIn, LogOut, MessageSquare, HelpCircle, Menu, RotateCcw } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useBookingFlowOptional } from '@/contexts/BookingFlowContext';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ReturningCustomerVerificationModal } from '@/components/ReturningCustomerVerificationModal';
import { siteImages } from '@/config/siteImages';

export const Header = ({ onReorderSelect }) => {
  const navigate = useNavigate();
  const bookingFlow = useBookingFlowOptional();
  const { user, isAdmin, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isReturningCustomerModalOpen, setIsReturningCustomerModalOpen] = useState(false);
  const isCustomer = user && !isAdmin;

  const handleAdminClick = () => {
    navigate('/admin');
    setIsOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
    setIsOpen(false);
  };

  const closeMenu = () => setIsOpen(false);

  const handleHomeNavigation = (e) => {
    if (bookingFlow?.isInBookingFlow) {
      e?.preventDefault();
      closeMenu();
      bookingFlow.requestLeaveBooking();
      return;
    }
    closeMenu();
    navigate('/');
  };

  const AuthButtons = ({ mobile = false }) => {
    const btnClass = mobile ? "w-full justify-start tap-target" : "tap-target";
    
    if (isAdmin) {
      return (
        <div className={`flex ${mobile ? 'flex-col gap-2' : 'items-center space-x-2'}`}>
          <Button onClick={handleAdminClick} variant="outline" className={`${btnClass} text-green-300 border-green-300 hover:bg-green-300 hover:text-black`}>
            Admin Dashboard
          </Button>
          <Button onClick={handleSignOut} variant="ghost" className={`${btnClass} hover:bg-red-500/20 hover:text-red-300`}>
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        </div>
      );
    }

    if (isCustomer) {
      return (
        <div className={`flex ${mobile ? 'flex-col gap-2' : 'items-center space-x-2'}`}>
          <Button onClick={() => { navigate('/customer-portal'); closeMenu(); }} variant="outline" className={`${btnClass} text-yellow-300 border-yellow-300 hover:bg-yellow-300 hover:text-black`}>
            Portal
          </Button>
          <Button onClick={handleSignOut} variant="ghost" className={`${btnClass} hover:bg-red-500/20 hover:text-red-300`}>
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        </div>
      );
    }
    
    return (
      <Button onClick={() => { navigate('/customer-login'); closeMenu(); }} variant="outline" className={`${btnClass} text-white border-white/50 hover:bg-white/20 hover:text-white`}>
        <LogIn className="mr-2 h-4 w-4" />
        Customer Portal
      </Button>
    );
  };

  const textEffectClass = "text-stone-900 drop-shadow-sm [text-shadow:0px_1px_1px_rgba(255,255,255,1),_0px_-1px_1px_rgba(0,0,0,0.4),_0px_0px_8px_rgba(255,255,255,0.6)]";

  return (
    <>
      <header className="sticky top-0 z-40 w-full bg-white backdrop-blur-md shadow-md border-b border-gray-200/50 transition-all duration-300">
        <nav className="container mx-auto px-4 h-full">
          <div className="flex items-center justify-between min-h-[140px] md:min-h-[180px] lg:min-h-[200px] relative w-full h-full">
            
            <div className="hidden lg:flex flex-1 items-center justify-end pr-4 xl:pr-8 h-full">
              <span className={`font-extrabold text-lg xl:text-xl text-center leading-snug tracking-tight uppercase ${textEffectClass}`}>
                U-Fill Dumpsters <br />
                Premium Waste Solutions
              </span>
            </div>

            <div className="flex-shrink-0 z-10 flex justify-center items-center h-full">
               <button
                  type="button"
                  onClick={handleHomeNavigation}
                  className="flex items-center group border-0 bg-transparent p-0 cursor-pointer"
                  aria-label="U-Fill Dumpsters home"
                >
                  <div className="relative p-0 transition-transform duration-300 group-hover:scale-105">
                    <img 
                      src={siteImages.logo} 
                      alt="U-Fill Dumpsters Logo" 
                      className="h-[120px] md:h-[160px] lg:h-[180px] w-auto max-w-[min(92vw,560px)] object-contain object-center bg-transparent select-none"
                      draggable={false}
                    />
                  </div>
              </button>
            </div>

            <div className="flex flex-1 items-center justify-end pl-4 xl:pl-8 h-full relative">
              <div className="hidden lg:flex items-center h-full mr-8">
                <span className={`font-extrabold text-lg xl:text-xl text-center leading-snug tracking-tight uppercase max-w-[400px] block ${textEffectClass}`}>
                  You fill it, we dump it.<br/>
                  Where we bring the convenience to you.
                </span>
              </div>
              
              <div className="flex items-center h-full">
                <Sheet open={isOpen} onOpenChange={setIsOpen}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-black hover:bg-black/10 tap-target h-14 w-14 rounded-full transition-colors shrink-0">
                      <Menu className="h-10 w-10 stroke-[2.5px]" />
                      <span className="sr-only">Toggle menu</span>
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="bg-blue-950 border-white/10 text-white w-[300px] sm:w-[400px]">
                    <div className="flex flex-col space-y-6 mt-8">
                      <button
                        type="button"
                        onClick={handleHomeNavigation}
                        className="text-xl font-bold text-white hover:text-yellow-300 flex items-center gap-2 tap-target text-left"
                      >
                        Home
                      </button>
                      <button
                        onClick={() => {
                          closeMenu();
                          setIsReturningCustomerModalOpen(true);
                        }}
                        className="flex items-center space-x-3 text-lg hover:text-yellow-400 transition-colors tap-target text-left"
                      >
                        <RotateCcw className="h-5 w-5" />
                        <span>Returning Customer</span>
                      </button>
                      <Link to="/contact" onClick={closeMenu} className="flex items-center space-x-3 text-lg hover:text-yellow-400 transition-colors tap-target">
                        <MessageSquare className="h-5 w-5" />
                        <span>Contact</span>
                      </Link>
                      <Link to="/faqs" onClick={closeMenu} className="flex items-center space-x-3 text-lg hover:text-yellow-400 transition-colors tap-target">
                        <HelpCircle className="h-5 w-5" />
                        <span>FAQ</span>
                      </Link>
                      <div className="pt-6 border-t border-white/20">
                        <AuthButtons mobile={true} />
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
            
          </div>
        </nav>
      </header>

      <ReturningCustomerVerificationModal
        isOpen={isReturningCustomerModalOpen}
        onClose={() => setIsReturningCustomerModalOpen(false)}
        onReorderSelect={(booking) => {
          onReorderSelect?.(booking);
          navigate('/');
        }}
        onCustomerVerified={(customerData) => {
          navigate('/', {
            state: {
              returningCustomerProfile: {
                customer: {
                  id: customerData?.contactAddress?.customerId || null,
                  first_name: customerData?.firstName || '',
                  last_name: customerData?.lastName || '',
                  email: customerData?.email || '',
                  phone: customerData?.phone || '',
                  street: customerData?.contactAddress?.street || '',
                  city: customerData?.contactAddress?.city || '',
                  state: customerData?.contactAddress?.state || '',
                  zip: customerData?.contactAddress?.zip || '',
                },
                email: customerData?.email || '',
              },
            },
          });
          setIsReturningCustomerModalOpen(false);
        }}
      />
    </>
  );
};
