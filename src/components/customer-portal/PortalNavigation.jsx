import React from 'react';
import { 
  LayoutDashboard, 
  List, 
  Map, 
  Calendar, 
  FileText, 
  User, 
  MessageSquare, 
  ShieldCheck,
  BookOpen,
  Menu
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export const PortalNavigation = ({ activeTab, onTabChange, hasUnreadMessages, hasPendingVerifications }) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'bookings', label: 'Bookings', icon: List },
    { id: 'tracking', label: 'Tracking', icon: Map },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'resources', label: 'How-To & Guides', icon: BookOpen },
    { id: 'profile', label: 'Profile', icon: User },
    { 
      id: 'verification', 
      label: 'Verification', 
      icon: ShieldCheck, 
      alert: hasPendingVerifications,
      alertColor: 'bg-orange-500' 
    },
    { 
      id: 'messages', 
      label: 'Communication', 
      icon: MessageSquare, 
      alert: hasUnreadMessages,
      alertColor: 'bg-red-500'
    }
  ];

  const NavContent = () => (
    <div className="flex flex-col h-full py-4 space-y-2">
      <div className="px-4 mb-4">
        <h2 className="text-xl font-bold text-yellow-400">My Portal</h2>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center space-x-3 px-3 py-3 rounded-lg transition-colors ${
                isActive 
                  ? 'bg-white/10 text-yellow-400 border border-white/10' 
                  : 'text-gray-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className={`h-5 w-5 ${isActive ? 'text-yellow-400' : 'text-gray-400'}`} />
              <span className="font-medium text-left">{item.label}</span>
              {item.alert && (
                <span className={`ml-auto w-2 h-2 rounded-full ${item.alertColor}`} />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );

  return (
    <>
      {/* Mobile Navigation */}
      <div className="lg:hidden flex items-center justify-between bg-black/40 p-4 border-b border-white/10 mb-4 rounded-xl">
        <h2 className="text-lg font-bold text-white capitalize">{activeTab.replace('-', ' ')}</h2>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] bg-gray-900 border-r border-white/10 p-0 text-white">
            <NavContent />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Navigation */}
      <div className="hidden lg:block w-64 bg-black/20 border border-white/10 rounded-xl mr-6 flex-shrink-0 h-[calc(100vh-120px)] sticky top-24 overflow-y-auto">
        <NavContent />
      </div>
    </>
  );
};