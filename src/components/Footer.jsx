import React from 'react';
import { Truck, Phone, Mail, Info } from 'lucide-react';
import { Link } from 'react-router-dom';

export const Footer = () => {
  return <footer className="bg-black/20 py-12 px-4 mt-16">
      <div className="container mx-auto text-center">
        <div className="flex items-center justify-center space-x-3 mb-6">
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-3 rounded-xl">
            <Truck className="h-8 w-8 text-white" />
          </div>
          <div>
            <span className="text-2xl font-bold text-white">U-Fill Dumpsters</span>
            <p className="text-blue-200 text-sm">Premium Waste & Delivery Solutions</p>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          <div>
            <Link to="/contact" className="inline-flex items-center justify-center group">
                <h3 className="font-semibold text-white mb-3 flex items-center group-hover:text-yellow-400 transition-colors">
                    <Info className="mr-2 h-5 w-5" />
                    Contact Us
                </h3>
            </Link>
            <div className="flex items-center justify-center space-x-2 text-blue-200">
                <Phone className="h-4 w-4" />
                <span>(801) 810-8832</span>
            </div>
            <a href="mailto:support@u-filldumpsters.com" className="flex items-center justify-center space-x-2 text-blue-200 hover:text-yellow-400 transition-colors mt-2">
                <Mail className="h-4 w-4" />
                <span>support@u-filldumpsters.com</span>
            </a>
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