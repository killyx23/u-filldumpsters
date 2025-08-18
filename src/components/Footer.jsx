import React from 'react';
import { Truck } from 'lucide-react';
export const Footer = () => {
  return <footer className="bg-black/20 py-12 px-4 mt-16">
      <div className="container mx-auto text-center">
        <div className="flex items-center justify-center space-x-3 mb-6">
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-3 rounded-xl">
            <Truck className="h-8 w-8 text-white" />
          </div>
          <div>
            <span className="text-2xl font-bold text-white">U-Fill Dumpsters</span>
            <p className="text-blue-200 text-sm">Premium Waste Solutions</p>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          <div>
            <h3 className="font-semibold text-white mb-3">Contact Info</h3>
            <p className="text-blue-200">(801) 810-8832</p>
            <p className="text-blue-200">billing@u-filldumpsters.com</p>
          </div>
          <div>
            <h3 className="font-semibold text-white mb-3">Service Areas</h3>
            <p className="text-blue-200">Saratoga Springs, Eagle Mountain, Lehi & Surrounding Areas.</p>
            <p className="text-blue-200">Daily, Weekly, and Monthly Rentals Available.</p>
          </div>
          <div>
            <h3 className="font-semibold text-white mb-3">Office Hours</h3>
            <p className="text-blue-200">Mon-Fri: 8AM - 2PM</p>
            <p className="text-blue-200">Sat 8AM - 10AM Closed Sunday
Email Us At: support@u-filldumpsters.com
for after-hours questions. </p>
          </div>
        </div>
        <div className="border-t border-white/20 pt-6">
          <p className="text-blue-200">&copy; {new Date().getFullYear()} U-Fill Dumpsters. All rights reserved.</p>
        </div>
      </div>
    </footer>;
};