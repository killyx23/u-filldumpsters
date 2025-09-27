import React from 'react';
import { Link } from 'react-router-dom';
export const Footer = () => {
  return <footer className="bg-black/20 text-white py-12 px-4 mt-16">
      <div className="container mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 text-center md:text-left">
        <div>
          <p className="font-bold text-lg text-yellow-400 mb-4">U-Fill Dumpsters</p>
          <p className="text-blue-200">Phone: (801) 810-8832</p>
          <p className="text-blue-200">Email: support@u-filldumpsters.com</p>
        </div>
        <div>
          <p className="font-bold text-lg text-yellow-400 mb-4">Quick Links</p>
          <ul className="space-y-2">
            <li><Link to="/" className="hover:text-yellow-300 transition-colors">Home</Link></li>
            <li><Link to="/faq" className="hover:text-yellow-300 transition-colors">FAQ</Link></li>
            <li><Link to="/contact" className="hover:text-yellow-300 transition-colors">Contact</Link></li>
             <li><Link to="/login" className="hover:text-yellow-300 transition-colors">Customer Portal</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-bold text-lg text-yellow-400 mb-4">Office Hours</p>
          <p className="text-blue-200">Mon-Fri: 8 AM - 10 AM</p>
          <p className="text-blue-200">Closed: Saturday & Sunday</p>
          <p className="text-blue-200 mt-2">24/7 Online Booking</p>
        </div>
        <div>
          <p className="font-bold text-lg text-yellow-400 mb-4">Legal</p>
           <p className="text-blue-200">U-Fill Dumpsters LLC is a fully licensed and insured company.</p>
        </div>
      </div>
      <div className="mt-8 pt-8 border-t border-white/10 text-center text-blue-200">
        <p>&copy; {new Date().getFullYear()} U-Fill Dumpsters LLC. All rights reserved.</p>
      </div>
    </footer>;
};