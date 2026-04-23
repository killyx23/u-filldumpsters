import React, { useState } from 'react';
import { MapPin, ExternalLink } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export const DeliveryLocationPreview = ({ deliveryAddress, isVerified, onVerificationChange }) => {
  const [mapError, setMapError] = useState(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!deliveryAddress?.street) {
    return null;
  }

  const fullAddress = `${deliveryAddress.street}, ${deliveryAddress.city}, ${deliveryAddress.state} ${deliveryAddress.zip}`;
  const encodedAddress = encodeURIComponent(fullAddress);
  
  const mapUrl = apiKey && !mapError
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${encodedAddress}&zoom=16&size=600x400&markers=color:red%7C${encodedAddress}&key=${apiKey}`
    : null;

  const googleMapsLink = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

  return (
    <div className="bg-white/5 p-6 rounded-lg mb-8 border border-white/10">
      <h3 className="text-2xl font-bold text-yellow-400 mb-4 border-b border-white/10 pb-2 flex items-center">
        <MapPin className="mr-2 h-6 w-6" />
        Delivery Location Verification
      </h3>
      
      <div className="space-y-4 text-white">
        <div className="w-full bg-gray-900 rounded-lg overflow-hidden border border-white/10 relative" style={{ minHeight: '240px' }}>
          {mapUrl ? (
            <img 
              src={mapUrl} 
              alt={`Map showing ${fullAddress}`}
              className="w-full h-full object-cover sm:h-[320px] md:h-[420px]"
              onError={() => setMapError(true)}
            />
          ) : (
            <div className="w-full h-full sm:h-[320px] md:h-[420px] flex flex-col items-center justify-center bg-gray-800 text-gray-400 p-4 text-center">
              <MapPin className="h-12 w-12 mb-3 opacity-50" />
              <p className="font-medium text-lg text-white mb-1">Map preview unavailable</p>
              {!apiKey && <p className="text-sm">API key is missing.</p>}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-black/20 p-3 rounded text-sm">
          <span className="text-blue-200/90 break-words">{fullAddress}</span>
          <a 
            href={googleMapsLink} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center text-yellow-400 hover:text-yellow-300 transition-colors whitespace-nowrap"
          >
            Open in Google Maps <ExternalLink className="ml-1.5 h-4 w-4" />
          </a>
        </div>

        <div className="flex items-start space-x-3 mt-6 bg-blue-900/20 p-4 rounded-lg border border-blue-500/30">
          <Checkbox
            id="verify-location"
            checked={isVerified}
            onCheckedChange={onVerificationChange}
            className="mt-1 border-white/50 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
          />
          <Label
            htmlFor="verify-location"
            className="text-base text-white leading-snug cursor-pointer select-none"
          >
            I confirm this map pin is the correct delivery location.
          </Label>
        </div>
      </div>
    </div>
  );
};