
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, CheckCircle, Truck, Loader2, AlertCircle, RefreshCw, Info, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GooglePlacesAutocomplete } from './GooglePlacesAutocomplete';
import { toast } from '@/components/ui/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useLoadScript } from '@react-google-maps/api';
import { fetchDistanceAndCalculateFee } from '@/services/DistanceCalculationService';
import { DeliveryServiceInfo } from './DeliveryServiceInfo';

const libraries = ['places'];

export const DeliveryAddressSection = ({ contactAddress, addonsData, setAddonsData, plan, fetchedMileageRate }) => {
  const { isLoaded } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    libraries,
  });

  const mileageRate = fetchedMileageRate !== undefined ? fetchedMileageRate : (plan?.mileage_rate || 20);

  const hasDelivery = !!addonsData.deliveryAddress?.street;
  const isSameAsContact = hasDelivery && contactAddress && addonsData.deliveryAddress.street === contactAddress.street;
  
  const [useDifferent, setUseDifferent] = useState(hasDelivery ? !isSameAsContact : false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  
  const initialCalcAttempted = useRef(false);

  const getTooltipText = () => {
      if (plan?.id === 1) {
          return `For the cost of delivery, it includes the first 30 miles for free, and then we take any additional miles from the delivery to the landfill, and from then on, the mileage is determined by the total cost per mile. The fees are based on the current gas price, which is currently ($${mileageRate.toFixed(2)}/mile).`;
      }
      return `How we calculate the round-trip driving distance is from Saratoga Springs, to the delivery drop off, then to the landfill, and then we take that mileage to determine the cost per mile. The fees are priced based on the current gas price, which is currently ($${mileageRate.toFixed(2)}/mile).`;
  };

  const calculateDistance = useCallback(async (address) => {
    if (!address || !address.street) return;
    
    if (!address.isVerified) {
        setAddonsData(prev => ({
            ...prev,
            deliveryAddress: { ...address, unverifiedAccepted: true },
            deliveryDistance: 0,
            mileageCharge: 0,
            deliveryFee: 0,
            distanceFeeDisplay: 'Pending Admin Verification'
        }));
        return;
    }

    if (!isLoaded || !window.google || !window.google.maps) {
      setError("Google Maps is currently loading. Please retry in a moment.");
      return;
    }

    setCalculating(true);
    setError(null);
    
    try {
      const fullAddress = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;
      
      const result = await fetchDistanceAndCalculateFee(fullAddress, plan?.id, mileageRate);

      if (result.error) {
        setError(result.error);
        setAddonsData(prev => ({
          ...prev,
          deliveryAddress: address,
          deliveryDistance: 0,
          mileageCharge: 0,
          deliveryFee: 0,
          distanceFeeDisplay: ''
        }));
      } else {
        setAddonsData(prev => ({
          ...prev,
          deliveryAddress: address,
          deliveryDistance: result.distance,
          mileageCharge: result.totalFee,
          deliveryFee: result.totalFee,
          distanceFeeDisplay: result.distanceFeeDisplay
        }));
        setError(null);
      }
    } catch (err) {
      console.error("Distance calculation error:", err);
      setError(err.message || "Failed to calculate delivery distance. Please try again.");
      toast({ title: "Distance calculation failed", description: err.message, variant: "destructive" });
      setAddonsData(prev => ({
        ...prev,
        deliveryAddress: address,
        deliveryDistance: 0,
        mileageCharge: 0,
        deliveryFee: 0,
        distanceFeeDisplay: ''
      }));
    } finally {
      setCalculating(false);
    }
  }, [isLoaded, setAddonsData, plan?.id, mileageRate]);

  const handleUseContact = () => {
    setUseDifferent(false);
    if (contactAddress?.street && contactAddress?.city && contactAddress?.state && contactAddress?.zip) {
      const newAddress = { ...contactAddress };
      setAddonsData(prev => ({ ...prev, deliveryAddress: newAddress }));
      calculateDistance(newAddress);
    } else {
      toast({ title: "Contact address not complete", description: "Please enter a complete delivery address.", variant: "destructive" });
      setUseDifferent(true);
    }
  };

  const handleAddressSelect = (details) => {
    const newAddress = { ...details, isVerified: true, unverifiedAccepted: false };
    setAddonsData(prev => ({ ...prev, deliveryAddress: newAddress }));
    calculateDistance(newAddress);
  };

  const handleManualAddressChange = (field, value) => {
    setAddonsData(prev => {
        const currentAddr = prev.deliveryAddress || {};
        const newAddr = { ...currentAddr, [field]: value, isVerified: false, unverifiedAccepted: true };
        
        // We trigger distance calculation bypassing so it sets "Pending Admin Verification"
        if (field === 'street' || field === 'city' || field === 'state' || field === 'zip') {
            calculateDistance(newAddr);
        }
        
        return { ...prev, deliveryAddress: newAddr };
    });
  };

  const handleRetry = () => {
    if (addonsData.deliveryAddress?.isVerified) {
      calculateDistance(addonsData.deliveryAddress);
    } else if (!useDifferent && contactAddress?.isVerified) {
      calculateDistance(contactAddress);
    }
  };

  useEffect(() => {
    if (isLoaded && !initialCalcAttempted.current) {
      initialCalcAttempted.current = true;
      
      const hasValidContact = contactAddress?.street && contactAddress?.city && contactAddress?.state && contactAddress?.zip;
      
      if (!useDifferent && hasValidContact && !addonsData.deliveryAddress) {
        const newAddress = { ...contactAddress };
        setAddonsData(prev => ({ ...prev, deliveryAddress: newAddress }));
        calculateDistance(newAddress);
      } else if (addonsData.deliveryAddress && addonsData.deliveryAddress.isVerified && !addonsData.deliveryDistance) {
        calculateDistance(addonsData.deliveryAddress);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  const isWaitingForMaps = !isLoaded && !initialCalcAttempted.current && 
    ((!useDifferent && contactAddress?.isVerified && !addonsData.deliveryAddress) || 
     (addonsData.deliveryAddress?.isVerified && !addonsData.deliveryDistance));
     
  const isCurrentlyCalculating = calculating || isWaitingForMaps;
  const isUnverified = !useDifferent ? !contactAddress?.isVerified : !addonsData.deliveryAddress?.isVerified;

  return (
    <div className="bg-black/20 p-6 rounded-xl border border-white/10 space-y-4">
        <DeliveryServiceInfo isOpen={showInfoModal} onClose={() => setShowInfoModal(false)} planId={plan?.id} />
        
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h3 className="text-xl font-semibold text-white flex items-center">
                <Truck className="mr-2 h-6 w-6 text-cyan-400" />
                Delivery Address
            </h3>
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowInfoModal(true)} className="text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10 text-xs hidden sm:flex">
                    View Pricing Details
                </Button>
                <div className="relative z-[9999]" style={{ zIndex: 9999 }}>
                    <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Info className="h-5 w-5 text-blue-300 hover:text-white transition-colors cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="left" sideOffset={10} className="bg-slate-800 text-white border-slate-700 max-w-sm z-[9999] relative shadow-2xl p-4">
                                <p className="leading-relaxed font-medium">{getTooltipText()}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>
        </div>

        {!useDifferent && contactAddress?.street && contactAddress?.city && contactAddress?.state && contactAddress?.zip ? (
            <div className="space-y-4">
                <div className={`bg-white/5 p-4 rounded-lg border flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-inner ${isUnverified ? 'border-orange-500/50' : 'border-white/10'}`}>
                    <div className="flex items-start w-full">
                        {isUnverified ? (
                            <AlertTriangle className="h-5 w-5 text-orange-400 mr-2 mt-0.5 flex-shrink-0" />
                        ) : (
                            <MapPin className="h-5 w-5 text-green-400 mr-2 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="w-full">
                            <p className="text-white font-medium">{contactAddress.street}</p>
                            <p className="text-blue-200 text-sm">{contactAddress.city}, {contactAddress.state} {contactAddress.zip}</p>
                            
                            {isUnverified ? (
                                <p className="text-xs text-orange-300 mt-2 bg-orange-900/20 p-2 rounded">
                                    Manual address entry. Delivery fees will be calculated by our team upon review.
                                </p>
                            ) : isCurrentlyCalculating ? (
                                <p className="text-xs text-yellow-400 mt-2 flex items-center distance-loading">
                                  <Loader2 className="h-3 w-3 animate-spin mr-1"/> Calculating route...
                                </p>
                            ) : error ? (
                                <div className="mt-2 flex flex-col items-start gap-2 text-red-400 text-xs error-message">
                                  <div className="flex items-center">
                                      <AlertCircle className="h-3 w-3 mr-1" /> {error}
                                  </div>
                                  <Button variant="outline" size="sm" onClick={handleRetry} className="h-6 px-2 border-red-500 text-red-400 hover:bg-red-500 hover:text-white retry-btn">
                                    <RefreshCw className="h-3 w-3 mr-1" /> Retry Calculation
                                  </Button>
                                </div>
                            ) : addonsData.deliveryDistance > 0 ? (
                                <div className="mt-2 space-y-1">
                                  <p className="text-xs text-cyan-300 font-semibold bg-cyan-900/20 inline-block px-2 py-1 rounded border border-cyan-800/50">
                                      {addonsData.distanceFeeDisplay || `Mileage Fee: $${addonsData.mileageCharge?.toFixed(2)}`}
                                  </p>
                                </div>
                            ) : null}
                        </div>
                    </div>
                    <Button disabled className="bg-green-600/20 text-green-400 border border-green-500/30 cursor-default shrink-0">
                        <CheckCircle className="mr-2 h-4 w-4" /> Using Contact Address
                    </Button>
                </div>
                <Button variant="link" onClick={() => setUseDifferent(true)} className="text-blue-300 hover:text-yellow-400 p-0 h-auto interactive-hover">
                    Deliver to a different address
                </Button>
            </div>
        ) : (
            <div className="space-y-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-white flex items-center">Search Delivery Address</label>
                    <GooglePlacesAutocomplete 
                        value={addonsData.deliveryAddress?.street || ''}
                        onChange={(val) => handleManualAddressChange('street', val)}
                        onAddressSelect={handleAddressSelect}
                        placeholder="Start typing your delivery address..."
                    />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="relative flex items-center">
                        <MapPin className="absolute left-3 h-4 w-4 text-blue-300" />
                        <input 
                            className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-9 pr-4 py-2 transition-colors" 
                            value={addonsData.deliveryAddress?.city || ''} 
                            onChange={(e) => handleManualAddressChange('city', e.target.value)}
                            placeholder="City" 
                        />
                    </div>
                    <div className="relative flex items-center">
                        <MapPin className="absolute left-3 h-4 w-4 text-blue-300" />
                        <input 
                            className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-9 pr-4 py-2 transition-colors" 
                            value={addonsData.deliveryAddress?.state || ''} 
                            onChange={(e) => handleManualAddressChange('state', e.target.value)}
                            placeholder="State" 
                        />
                    </div>
                    <div className="relative flex items-center">
                        <MapPin className="absolute left-3 h-4 w-4 text-blue-300" />
                        <input 
                            className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-9 pr-4 py-2 transition-colors" 
                            value={addonsData.deliveryAddress?.zip || ''} 
                            onChange={(e) => handleManualAddressChange('zip', e.target.value)}
                            placeholder="ZIP" 
                        />
                    </div>
                </div>
                
                {isUnverified && addonsData.deliveryAddress?.street ? (
                    <div className="bg-orange-900/30 border border-orange-500/50 p-3 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="h-5 w-5 text-orange-400 flex-shrink-0 mt-0.5" />
                        <p className="text-orange-200 text-sm">
                            Manual address entry requires admin verification. Delivery fees will be calculated and applied during the review process.
                        </p>
                    </div>
                ) : isCurrentlyCalculating ? (
                   <p className="text-sm text-yellow-400 flex items-center distance-loading"><Loader2 className="h-4 w-4 animate-spin mr-2"/> Calculating route...</p>
                ) : error ? (
                   <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between text-red-400 text-sm bg-red-900/20 p-3 rounded-lg border border-red-500/30 gap-3 error-message">
                      <div className="flex items-center">
                          <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" /> 
                          <span>{error}</span>
                      </div>
                      <Button variant="outline" size="sm" onClick={handleRetry} className="flex-shrink-0 border-red-500 text-red-400 hover:bg-red-500 hover:text-white retry-btn">
                        <RefreshCw className="h-3 w-3 mr-2" /> Retry Calculation
                      </Button>
                   </div>
                ) : addonsData.deliveryAddress?.isVerified && addonsData.deliveryDistance > 0 && (
                    <div className="bg-green-900/30 border border-green-500/30 p-4 rounded-lg space-y-2">
                        <div className="text-cyan-300 text-sm font-medium">
                            {addonsData.distanceFeeDisplay || `Mileage Fee: $${addonsData.mileageCharge?.toFixed(2)}`}
                        </div>
                    </div>
                )}

                {contactAddress?.street && contactAddress?.city && contactAddress?.state && contactAddress?.zip && (
                    <div className="pt-2">
                        <Button variant="outline" onClick={handleUseContact} className="text-white border-white/30 hover:bg-white/10 interactive-hover">
                            Cancel and use Contact Address
                        </Button>
                    </div>
                )}
            </div>
        )}
    </div>
  );
}
