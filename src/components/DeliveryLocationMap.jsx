import React from 'react';
import { MapPin, ExternalLink, AlertTriangle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export const DeliveryLocationMap = ({ deliveryAddress, isVerified, onVerificationChange }) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    return (
      <div className="bg-white/5 p-6 rounded-lg mb-8 border border-red-500/30 flex flex-col items-center justify-center text-center">
        <AlertTriangle className="h-10 w-10 text-red-400 mb-3" />
        <h4 className="text-lg font-semibold text-red-200 mb-1">Map configuration incomplete</h4>
        <p className="text-sm text-red-300/80 mb-4">Google Maps API key is missing.</p>
        <div className="flex items-center space-x-3 bg-red-950/30 p-4 rounded-lg border border-red-500/20 w-full justify-center">
          <Checkbox
            id="verify-location-fallback"
            checked={isVerified}
            onCheckedChange={onVerificationChange}
            className="border-white/50 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
          />
          <Label htmlFor="verify-location-fallback" className="text-sm text-blue-100 cursor-pointer">
            I confirm the delivery location is correct (Map unavailable)
          </Label>
        </div>
      </div>
    );
  }

  const { street, city, state, zip } = deliveryAddress || {};
  
  if (!street || !city || !state) {
    return null; // Don't render if address is totally invalid
  }

  const fullAddress = `${street}, ${city}, ${state} ${zip || ''}`.trim();
  const encodedAddress = encodeURIComponent(fullAddress);
  const mapUrl = `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encodedAddress}`;
  const fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

  return (
    <div className="bg-white/5 p-6 rounded-lg mb-8 border border-white/10 shadow-lg">
      <h3 className="text-2xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2 flex items-center">
        <MapPin className="mr-2 h-6 w-6" /> Delivery Location
      </h3>
      
      <div className="relative w-full rounded-md overflow-hidden border border-white/10 mb-4 bg-slate-800">
        <iframe
          title="Delivery Location Map"
          width="100%"
          className="w-full h-[320px] md:h-[380px] lg:h-[420px] border-0"
          loading="lazy"
          allowFullScreen
          src={mapUrl}
        ></iframe>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 gap-3">
        <p className="text-sm text-blue-200/80 truncate" title={fullAddress}>
          {fullAddress}
        </p>
        <a 
          href={fallbackUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="inline-flex items-center text-sm text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
        >
          <ExternalLink className="h-4 w-4 mr-1" /> Open in Google Maps
        </a>
      </div>

      <div className="flex items-start space-x-3 bg-slate-900/50 p-4 rounded-lg border border-white/5">
        <Checkbox
          id="verify-location-map"
          checked={isVerified}
          onCheckedChange={onVerificationChange}
          className="mt-1 border-white/50 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
        />
        <Label
          htmlFor="verify-location-map"
          className="text-sm md:text-base text-blue-50 leading-snug cursor-pointer select-none"
        >
          I confirm this map pin is the correct delivery location.
        </Label>
      </div>
    </div>
  );
};