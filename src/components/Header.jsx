import React from 'react';
import { Truck, Phone, Mail, TestTube2, MessageSquare, HelpCircle, LogOut } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';

export const Header = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const isAdmin = user?.user_metadata?.is_admin;

  const handleTestClick = () => {
    navigate('/admin');
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <header className="bg-white/10 backdrop-blur-md border-b border-white/20 sticky top-0 z-40">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Button
              variant="ghost"
              size="icon"
              className="group hover:bg-purple-600/50"
              onClick={handleTestClick}
              aria-label="Admin Test Button"
            >
              <TestTube2 className="h-6 w-6 text-purple-300 group-hover:text-white transition-colors" />
            </Button>
            <Link to="/" className="flex items-center space-x-3 cursor-pointer group">
                <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-3 rounded-xl group-hover:scale-105 transition-transform">
                <Truck className="h-8 w-8 text-white" />
                </div>
                <div>
                <h1 className="text-2xl font-bold text-white group-hover:text-yellow-300 transition-colors">U-Fill Dumpsters</h1>
                <p className="text-blue-200 text-sm">Premium Waste Solutions</p>
                </div>
            </Link>
          </div>
          <div className="hidden md:flex items-center space-x-6 text-white">
            <div className="flex items-center space-x-2">
              <Phone className="h-4 w-4" />
              <span>(801) 810-8832</span>
            </div>
            <div className="flex items-center space-x-2">
              <Mail className="h-4 w-4" />
              <span>billing@u-filldumpsters.com</span>
            </div>
            <Link to="/contact" className="flex items-center space-x-2 hover:text-yellow-400 transition-colors">
              <MessageSquare className="h-4 w-4" />
              <span>Contact</span>
            </Link>
            <Link to="/faq" className="flex items-center space-x-2 hover:text-yellow-400 transition-colors">
              <HelpCircle className="h-4 w-4" />
              <span>FAQ</span>
            </Link>
            {isAdmin && (
              <Button onClick={handleSignOut} variant="ghost" className="hover:bg-red-500/20 hover:text-red-300">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};