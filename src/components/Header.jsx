import React from 'react';
import { Truck, Phone, Mail } from 'lucide-react';

export const Header = () => {
  return (
    <header className="bg-white/10 backdrop-blur-md border-b border-white/20 sticky top-0 z-40">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-3 rounded-xl">
              <Truck className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">U-Fill Dumpsters</h1>
              <p className="text-blue-200 text-sm">Premium Waste Solutions</p>
            </div>
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
          </div>
        </div>
      </div>
    </header>
  );
};