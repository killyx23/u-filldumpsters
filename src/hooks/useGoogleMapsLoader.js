import { useState, useEffect } from 'react';

let googleMapsPromise = null;

export const loadGoogleMaps = () => {
    // If it's already loaded globally, resolve immediately
    if (window.google && window.google.maps) {
        return Promise.resolve(window.google.maps);
    }
    
    // If a load is already in progress, return the existing promise
    if (googleMapsPromise) {
        return googleMapsPromise;
    }

    googleMapsPromise = new Promise((resolve, reject) => {
        // 10-second timeout to prevent infinite waiting
        const timeoutId = setTimeout(() => {
            googleMapsPromise = null;
            reject(new Error("Google Maps script loading timed out after 10 seconds."));
        }, 10000);

        // Check if script is already injected by another library (e.g. @react-google-maps/api)
        const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
        if (existingScript) {
            if (window.google && window.google.maps) {
                clearTimeout(timeoutId);
                resolve(window.google.maps);
                return;
            }
            const onLoad = () => {
                clearTimeout(timeoutId);
                existingScript.removeEventListener('load', onLoad);
                existingScript.removeEventListener('error', onError);
                if (window.google && window.google.maps) {
                    resolve(window.google.maps);
                } else {
                    googleMapsPromise = null;
                    reject(new Error("Google Maps loaded but window.google.maps is unavailable."));
                }
            };
            const onError = () => {
                clearTimeout(timeoutId);
                existingScript.removeEventListener('load', onLoad);
                existingScript.removeEventListener('error', onError);
                googleMapsPromise = null;
                reject(new Error("Failed to load existing Google Maps script."));
            };
            existingScript.addEventListener('load', onLoad);
            existingScript.addEventListener('error', onError);
            return;
        }

        const script = document.createElement('script');
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
        
        if (!apiKey) {
            clearTimeout(timeoutId);
            googleMapsPromise = null;
            return reject(new Error("Google Maps API key is missing."));
        }
        
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
        script.async = true;
        script.defer = true;

        script.onload = () => {
            clearTimeout(timeoutId);
            if (window.google && window.google.maps) {
                resolve(window.google.maps);
            } else {
                reject(new Error("Google Maps loaded but maps object is unavailable."));
            }
        };

        script.onerror = () => {
            clearTimeout(timeoutId);
            googleMapsPromise = null;
            reject(new Error("Failed to load Google Maps script."));
        };

        document.head.appendChild(script);
    });

    return googleMapsPromise;
};

export const useGoogleMapsLoader = () => {
    const [isLoaded, setIsLoaded] = useState(!!(window.google && window.google.maps));
    const [isLoading, setIsLoading] = useState(!window.google?.maps);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isLoaded) return;

        let isMounted = true;
        
        loadGoogleMaps()
            .then(() => {
                if (isMounted) {
                    setIsLoaded(true);
                    setIsLoading(false);
                    setError(null);
                }
            })
            .catch((err) => {
                if (isMounted) {
                    setError(err.message);
                    setIsLoading(false);
                    setIsLoaded(false);
                }
            });

        return () => {
            isMounted = false;
        };
    }, [isLoaded]);

    return { isLoaded, isLoading, error };
};