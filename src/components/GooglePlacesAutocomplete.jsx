import React, { useState, useEffect, useRef } from 'react';
import { useGooglePlacesAutocomplete } from '@/hooks/useGooglePlacesAutocomplete';
import { Home, MapPin, Loader2, X, AlertCircle, Edit2 } from 'lucide-react';
import { AddressVerificationDialog } from './AddressVerificationDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.GOOGLE_MAPS_API_KEY || "";

export const GooglePlacesAutocomplete = ({ 
  value = "", 
  onChange, 
  onAddressSelect, 
  placeholder = "Start typing your address...",
  required = false
}) => {
  const [manualMode, setManualMode] = useState(false);
  const [showVerificationDialog, setShowVerificationDialog] = useState(false);
  const [manualAddress, setManualAddress] = useState({ street: value || '', city: '', state: '', zip: '' });
  
  const { 
    isLoaded, 
    loadError,
    suggestions = [], 
    loading, 
    error: apiError, 
    fetchSuggestions, 
    getPlaceDetails, 
    clearSuggestions,
    retryCount
  } = useGooglePlacesAutocomplete(GOOGLE_API_KEY);

  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");
  const [debouncedInputValue, setDebouncedInputValue] = useState(value || "");
  const wrapperRef = useRef(null);

  // Sync internal input value with external value if it changes externally (e.g. initial load)
  useEffect(() => {
    if (value !== inputValue && !isOpen) {
      setInputValue(value || "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    // Trigger manual mode only if there's a hard failure or missing key
    if (!GOOGLE_API_KEY || loadError || retryCount >= 3 || (apiError && apiError.includes("REQUEST_DENIED"))) {
      if (!manualMode) {
        console.warn("[GooglePlacesAutocomplete] Triggering automatic manual mode fallback.");
        setManualMode(true);
      }
    }
  }, [loadError, retryCount, apiError, manualMode]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  // Handle debouncing
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedInputValue(inputValue);
    }, 300); // Optimized to 300ms for better responsiveness
    return () => clearTimeout(timeoutId);
  }, [inputValue]);

  // Fetch suggestions when debounced value changes
  useEffect(() => {
    if (manualMode) return;
    
    if (debouncedInputValue && isOpen && debouncedInputValue.trim().length >= 2) {
      fetchSuggestions(debouncedInputValue);
    } else if (!debouncedInputValue || debouncedInputValue.trim().length < 2) {
      clearSuggestions();
    }
  }, [debouncedInputValue, fetchSuggestions, clearSuggestions, isOpen, manualMode]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);
    setIsOpen(true);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent form submission
      if (isOpen && suggestions.length > 0) {
        handleSelectSuggestion(suggestions[0].place_id, suggestions[0].description);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleSelectSuggestion = async (placeId, description) => {
    setInputValue(description);
    onChange(description);
    setIsOpen(false);
    clearSuggestions();
    
    try {
      const details = await getPlaceDetails(placeId);
      if (onAddressSelect) {
        onAddressSelect(details);
      }
    } catch (err) {
      console.error("[GooglePlacesAutocomplete] Error fetching details:", err);
    }
  };

  const clearInput = () => {
    setInputValue('');
    onChange('');
    setIsOpen(false);
    clearSuggestions();
  };

  const handleManualSubmit = () => {
    if (manualAddress.street && manualAddress.city && manualAddress.state && manualAddress.zip) {
      const fullAddr = `${manualAddress.street}, ${manualAddress.city}, ${manualAddress.state} ${manualAddress.zip}`;
      onChange(fullAddr);
      if (onAddressSelect) {
        onAddressSelect({ 
          ...manualAddress, 
          isVerified: false, 
          unverifiedAccepted: true 
        });
      }
    }
  };

  if (manualMode) {
    return (
      <div className="relative flex flex-col space-y-3 w-full bg-black/20 p-4 rounded-xl border border-orange-500/30">
        <div className="flex items-center text-sm font-semibold text-orange-400 mb-1">
          <Edit2 className="h-4 w-4 mr-2" />
          Manual Address Entry
        </div>
        <p className="text-xs text-orange-200 mb-2">Manual address entry should only be used if there is no match or if the address is not yet on Google Maps. You can also use this option if you don't have the exact address handy and plan to update it in our portal shortly.</p>
        
        <Input 
          type="text" 
          value={manualAddress.street} 
          onChange={(e) => setManualAddress({...manualAddress, street: e.target.value})} 
          placeholder="Street Address (e.g. 123 Main St)"
          required={required}
          className="bg-white/10 text-white border-white/30" 
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input 
            placeholder="City" 
            value={manualAddress.city} 
            onChange={(e) => setManualAddress({...manualAddress, city: e.target.value})} 
            className="bg-white/10 text-white border-white/30" 
          />
          <Input 
            placeholder="State" 
            value={manualAddress.state} 
            onChange={(e) => setManualAddress({...manualAddress, state: e.target.value})} 
            className="bg-white/10 text-white border-white/30" 
          />
        </div>
        <Input 
          placeholder="ZIP Code" 
          value={manualAddress.zip} 
          onChange={(e) => setManualAddress({...manualAddress, zip: e.target.value})} 
          className="bg-white/10 text-white border-white/30" 
        />
        
        <div className="flex gap-2 mt-2">
          <Button type="button" onClick={handleManualSubmit} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white">
            Use this address
          </Button>
          {GOOGLE_API_KEY && (
            <Button type="button" variant="outline" onClick={() => setManualMode(false)} className="flex-1 border-white/20 text-white hover:bg-white/10">
              Cancel
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full flex flex-col" ref={wrapperRef}>
      <AddressVerificationDialog 
        isOpen={showVerificationDialog} 
        onOpenChange={setShowVerificationDialog} 
        onContinue={() => setManualMode(true)} 
      />

      <div className="relative flex items-center w-full">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-300 pointer-events-none z-10">
          <Home />
        </span>
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder={!isLoaded ? "Loading address service..." : placeholder}
          disabled={!isLoaded}
          required={required}
          autoComplete="off"
          className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-10 pr-10 py-3 placeholder-blue-200 disabled:opacity-50 relative z-10"
        />
        {inputValue && (
          <button 
            type="button"
            onClick={clearInput}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white z-10 focus:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {apiError && (
        <div className="text-xs text-red-400 flex items-center mt-2 bg-red-900/20 p-2 rounded border border-red-500/30">
          <AlertCircle className="h-3 w-3 mr-1" /> {apiError}
        </div>
      )}

      {isOpen && debouncedInputValue?.trim().length >= 2 && (
        <div className="absolute top-full left-0 z-[100] w-full mt-2 bg-gray-900 border border-yellow-500/30 rounded-md shadow-2xl max-h-60 overflow-y-auto backdrop-blur-md">
          {loading && suggestions.length === 0 && (
            <div className="p-4 text-sm text-yellow-400 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching addresses...
            </div>
          )}
          
          {!loading && suggestions.length === 0 && !apiError && debouncedInputValue && (
             <div className="p-4 text-sm text-gray-400 text-center">
               No results found. Try adjusting your search.
             </div>
          )}

          {suggestions.map((suggestion) => (
            <div
              key={suggestion.place_id}
              className="p-3 hover:bg-white/10 cursor-pointer flex items-start text-white border-b border-white/5 last:border-0 transition-colors"
              onClick={() => handleSelectSuggestion(suggestion.place_id, suggestion.description)}
            >
              <MapPin className="h-5 w-5 mr-3 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm">
                  {suggestion.structured_formatting?.main_text || suggestion.description}
                </p>
                <p className="text-xs text-blue-300">
                  {suggestion.structured_formatting?.secondary_text}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={() => setShowVerificationDialog(true)}
          className="text-xs text-blue-300 hover:text-yellow-400 underline transition-colors focus:outline-none"
        >
          Can't find your address? Enter manually
        </button>
      </div>
    </div>
  );
};