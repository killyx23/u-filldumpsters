import { useState, useCallback, useRef, useEffect } from 'react';
import { useLoadScript } from '@react-google-maps/api';

const libraries = ['places'];

export const useGooglePlacesAutocomplete = (apiKey) => {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey,
    libraries,
  });

  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const autocompleteService = useRef(null);
  const placesService = useRef(null);
  const sessionToken = useRef(null);
  const retryCount = useRef(0);

  useEffect(() => {
    if (isLoaded && !loadError && window.google) {
      try {
        autocompleteService.current = new window.google.maps.places.AutocompleteService();
        placesService.current = new window.google.maps.places.PlacesService(document.createElement('div'));
        sessionToken.current = new window.google.maps.places.AutocompleteSessionToken();
        setError(null);
      } catch (err) {
        console.error("[GooglePlaces] Error initializing services:", err);
        setError("Failed to initialize Google Maps services.");
      }
    } else if (loadError) {
      console.error("[GooglePlaces] Script load error:", loadError);
      setError("Failed to load Google Maps script. Check API key and restrictions.");
    }
  }, [isLoaded, loadError]);

  const fetchSuggestions = useCallback((input) => {
    if (!apiKey) {
      setError("Google Places API key not configured.");
      return;
    }

    if (!isLoaded || loadError || !autocompleteService.current) {
      return;
    }

    if (!input || input.trim() === '') {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const request = {
      input,
      sessionToken: sessionToken.current,
      componentRestrictions: { country: 'us' },
      types: ['address'],
    };

    let timeoutFired = false;
    const timeoutId = setTimeout(() => {
      timeoutFired = true;
      setLoading(false);
      setError("Request timed out. Please try again.");
    }, 5000);

    try {
      autocompleteService.current.getPlacePredictions(
        request,
        (predictions, status) => {
          if (timeoutFired) return;
          clearTimeout(timeoutId);
          setLoading(false);
          
          if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
            retryCount.current = 0; 
            setSuggestions(predictions);
          } else if (status === window.google.maps.places.PlacesServiceStatus.ZERO_RESULTS || !predictions) {
            setSuggestions([]);
          } else {
            console.error(`[GooglePlaces] API Error: ${status}`);
            retryCount.current += 1;
            setError(
              status === 'REQUEST_DENIED' 
                ? "Address lookup is currently unavailable (Request Denied)."
                : `Failed to fetch suggestions (${status}).`
            );
            setSuggestions([]);
          }
        }
      );
    } catch (err) {
      clearTimeout(timeoutId);
      setLoading(false);
      setError("An unexpected error occurred while fetching addresses.");
      setSuggestions([]);
    }
  }, [isLoaded, loadError, apiKey]);

  const getPlaceDetails = useCallback((placeId) => {
    return new Promise((resolve, reject) => {
      if (!placesService.current) {
        reject(new Error("Places service not initialized"));
        return;
      }

      setLoading(true);
      const request = {
        placeId,
        sessionToken: sessionToken.current,
        fields: ['address_components', 'formatted_address', 'geometry'],
      };
      
      try {
        placesService.current.getDetails(
          request,
          (place, status) => {
            setLoading(false);
            // Refresh token after a selection
            sessionToken.current = new window.google.maps.places.AutocompleteSessionToken();
            
            if (status === window.google.maps.places.PlacesServiceStatus.OK && place) {
              const parsedAddress = {
                street: '',
                city: '',
                state: '',
                zip: '',
                formatted: place.formatted_address,
                lat: place.geometry?.location?.lat(),
                lng: place.geometry?.location?.lng(),
              };

              let streetNumber = '';
              let route = '';

              place.address_components?.forEach(component => {
                const types = component.types;
                if (types.includes('street_number')) streetNumber = component.long_name;
                else if (types.includes('route')) route = component.short_name;
                else if (types.includes('locality') || types.includes('sublocality')) parsedAddress.city = component.long_name;
                else if (types.includes('administrative_area_level_1')) parsedAddress.state = component.short_name;
                else if (types.includes('postal_code')) parsedAddress.zip = component.long_name;
              });

              parsedAddress.street = `${streetNumber} ${route}`.trim();
              resolve(parsedAddress);
            } else {
              reject(new Error(`Failed to get place details: ${status}`));
            }
          }
        );
      } catch (err) {
        setLoading(false);
        reject(err);
      }
    });
  }, []);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setLoading(false);
  }, []);

  return {
    isLoaded,
    loadError,
    suggestions,
    loading,
    error,
    fetchSuggestions,
    getPlaceDetails,
    clearSuggestions,
    retryCount: retryCount.current
  };
};