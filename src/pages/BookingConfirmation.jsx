
import React from 'react';
import { useLocation, Link, Navigate } from 'react-router-dom';
import { CheckCircle, Home, AlertTriangle, Calendar, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function BookingConfirmation() {
  const location = useLocation();
  const state = location.state || {};
  
  // Safe default values if routed here without state
  const { 
    bookingId = "Pending", 
    customerEmail = "", 
    unverifiedAddress = false,
    date = "",
    address = ""
  } = state;

  return (
    <div className="container mx-auto px-4 py-16 flex flex-col items-center">
      <div className="bg-white/10 backdrop-blur-md p-8 rounded-2xl border border-white/20 shadow-2xl max-w-2xl w-full text-center">
        
        <div className="flex justify-center mb-6">
          <div className="h-24 w-24 bg-green-500/20 rounded-full flex items-center justify-center border-4 border-green-400">
            <CheckCircle className="w-12 h-12 text-green-400" />
          </div>
        </div>
        
        <h1 className="text-4xl font-bold text-white mb-4">Booking Confirmed!</h1>
        
        <p className="text-xl text-blue-200 mb-8">
          Thank you for choosing U-Fill Dumpsters. Your order has been placed successfully.
        </p>
        
        <div className="bg-black/30 p-6 rounded-xl mb-8 text-left space-y-4">
           <p className="text-white"><span className="text-blue-300 font-semibold w-24 inline-block">Booking ID:</span> #{bookingId}</p>
           {customerEmail && <p className="text-white"><span className="text-blue-300 font-semibold w-24 inline-block">Email:</span> {customerEmail}</p>}
           {date && <p className="text-white flex items-center"><Calendar className="h-5 w-5 text-blue-300 mr-2"/> {date}</p>}
           {address && <p className="text-white flex items-center"><MapPin className="h-5 w-5 text-blue-300 mr-2"/> {address}</p>}
        </div>

        {unverifiedAddress && (
          <div className="bg-amber-900/40 border border-amber-500/50 p-5 rounded-lg mb-8 text-amber-100 flex items-start text-left shadow-lg">
            <AlertTriangle className="h-6 w-6 mr-3 flex-shrink-0 text-amber-400 mt-0.5" />
            <div>
              <p className="font-bold text-amber-300 mb-1">Manual Review Required</p>
              <p className="text-sm">Your delivery address could not be automatically verified. Our team will review the address details manually prior to delivery. We will contact you if any clarification is needed.</p>
            </div>
          </div>
        )}
        
        <p className="text-gray-300 mb-8 leading-relaxed">
          We've sent a detailed confirmation email with your booking summary and receipt. If you have any questions or need to make changes, please don't hesitate to contact our support team.
        </p>
        
        <Button asChild size="lg" className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto font-semibold py-6">
          <Link to="/">
            <Home className="mr-2 h-5 w-5" /> 
            Return to Homepage
          </Link>
        </Button>
        
      </div>
    </div>
  );
}
