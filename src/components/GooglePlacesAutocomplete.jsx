import React, { useState, useEffect, useRef } from 'react';
import { useGooglePlacesAutocomplete } from '@/hooks/useGooglePlacesAutocomplete';
import { Home, MapPin, Loader2, X, AlertCircle, Edit2 } from 'lucide-react';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

export const GooglePlacesAutocomplete = ({ 
  value, 
  onChange, 
  onAddressSelect, 
  placeholder = "Start typing your address...",
  required = false
}) => {
  const [manualMode, setManualMode] = useState(!GOOGLE_API_KEY);
  
  const { 
    isLoaded, 
    loadError,
    suggestions, 
    loading, 
    error: apiError, 
    fetchSuggestions, 
    getPlaceDetails, 
    clearSuggestions,
    retryCount
  } = useGooglePlacesAutocomplete(GOOGLE_API_KEY);

  const [isOpen, setIsOpen] = useState(false);
  const [debouncedInputValue, setDebouncedInputValue] = useState(value);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_API_KEY || loadError || retryCount >= 2 || (apiError && apiError.includes("REQUEST_DENIED"))) {
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

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedInputValue(value);
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [value]);

  useEffect(() => {
    if (manualMode) return;
    
    if (debouncedInputValue && isOpen && debouncedInputValue.length > 2) {
      fetchSuggestions(debouncedInputValue);
    } else if (!debouncedInputValue || debouncedInputValue.length <= 2) {
      clearSuggestions();
    }
  }, [debouncedInputValue, fetchSuggestions, clearSuggestions, isOpen, manualMode]);

  const handleInputChange = (e) => {
    onChange(e.target.value);
    setIsOpen(true);
  };

  const handleSelectSuggestion = async (placeId, description) => {
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
    onChange('');
    setIsOpen(false);
    clearSuggestions();
  };

  if (manualMode) {
    return (
      <div className="relative flex flex-col space-y-2 w-full">
        <div className="relative flex items-center">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-300">
            <Home />
          </span>
          <input 
            type="text" 
            value={value} 
            onChange={(e) => onChange(e.target.value)} 
            placeholder="Street Address (e.g. 123 Main St)"
            required={required}
            className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-10 pr-4 py-3 placeholder-blue-200" 
          />
        </div>
        <div className="flex items-center text-xs text-blue-200 bg-blue-900/20 p-2 rounded border border-blue-500/30">
          <Edit2 className="h-4 w-4 mr-2 flex-shrink-0 text-blue-400" />
          <span>Manual Entry Mode active. Please ensure your address is accurate.</span>
        </div>
        {apiError && (
          <div className="text-xs text-red-400 mt-1">
             {apiError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full flex flex-col" ref={wrapperRef}>
      <div className="relative flex items-center w-full">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-300 pointer-events-none z-10">
          <Home />
        </span>
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={!isLoaded ? "Loading address service..." : placeholder}
          disabled={!isLoaded}
          required={required}
          autoComplete="off"
          className="w-full bg-white/10 text-white rounded-lg border border-white/30 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 pl-10 pr-10 py-3 placeholder-blue-200 disabled:opacity-50 relative z-10"
        />
        {value && (
          <button 
            type="button"
            onClick={clearInput}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white z-10"
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

      {isOpen && debouncedInputValue?.length > 2 && (
        <div className="absolute top-full left-0 z-[100] w-full mt-2 bg-gray-900 border border-yellow-500/30 rounded-md shadow-2xl max-h-60 overflow-y-auto backdrop-blur-md">
          {loading && suggestions.length === 0 && (
            <div className="p-4 text-sm text-yellow-400 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching addresses...
            </div>
          )}
          
          {!loading && suggestions.length === 0 && !apiError && (
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
          onClick={() => setManualMode(true)}
          className="text-xs text-blue-300 hover:text-yellow-400 underline transition-colors"
        >
          Can't find your address? Enter manually
        </button>
      </div>
    </div>
  );
};