import { supabase } from '@/lib/customSupabaseClient';
import { loadGoogleMaps } from '@/hooks/useGoogleMapsLoader';

const LANDFILL_LOCATION = "800 S Allen Ranch Rd, Fairfield, UT 84013";

/**
 * Fetches the business address from the business_settings table.
 * Falls back to the default verified address if not found.
 */
export const getBusinessAddress = async () => {
    try {
        const { data, error } = await supabase
            .from('business_settings')
            .select('setting_value')
            .eq('setting_key', 'business_address')
            .single();

        if (!error && data && data.setting_value) {
            if (typeof data.setting_value === 'object' && data.setting_value.address) {
                console.log("[DistanceHelper] Fetched business address from DB object:", data.setting_value.address);
                return data.setting_value.address;
            } else if (typeof data.setting_value === 'string') {
                console.log("[DistanceHelper] Fetched business address from DB string:", data.setting_value);
                return data.setting_value;
            }
        }
    } catch (err) {
        console.warn('[DistanceHelper] Error fetching business address, using fallback:', err);
    }
    
    // Explicit exact spelling required for precise 55.1 miles Google Maps route
    const fallback = "227 West Casi Way, Saratoga Springs, Utah, 84045";
    console.log("[DistanceHelper] Using fallback business address:", fallback);
    return fallback;
};

/**
 * Formats a customer's address into a single string.
 */
export const formatFullAddress = (customer) => {
    if (!customer || !customer.street || !customer.city || !customer.state || !customer.zip) {
        return null;
    }
    const street = customer.street.trim();
    const city = customer.city.trim();
    const state = customer.state.trim();
    const zip = customer.zip.trim();
    return `${street}, ${city}, ${state} ${zip}`;
};

/**
 * Calls the Google Maps Distance Matrix API directly from the browser.
 */
export const calculateDistanceViaGoogleMaps = async (origin, destination) => {
    try {
        await loadGoogleMaps();
    } catch (err) {
        throw new Error(`Google Maps not loaded: ${err.message}`);
    }

    return new Promise((resolve, reject) => {
        if (!window.google || !window.google.maps || !window.google.maps.DistanceMatrixService) {
            return reject(new Error("Google Maps API is loaded but DistanceMatrixService is unavailable."));
        }

        const service = new window.google.maps.DistanceMatrixService();
        
        service.getDistanceMatrix({
            origins: [origin],
            destinations: [destination],
            travelMode: window.google.maps.TravelMode.DRIVING,
            unitSystem: window.google.maps.UnitSystem.IMPERIAL,
            drivingOptions: {
                departureTime: new Date(),
                trafficModel: 'bestguess'
            }
        }, (response, status) => {
            if (status !== window.google.maps.DistanceMatrixStatus.OK) {
                return reject(new Error(`Google Maps API call failed: ${status}`));
            }

            if (!response.rows || !response.rows[0] || !response.rows[0].elements || !response.rows[0].elements[0]) {
                return reject(new Error("Unexpected response structure from Google Maps."));
            }

            const element = response.rows[0].elements[0];
            
            if (element.status !== window.google.maps.DistanceMatrixElementStatus.OK) {
                return reject(new Error(`Cannot calculate route to this address: ${element.status}`));
            }

            const distanceMiles = parseFloat((element.distance.value / 1609.34).toFixed(1));
            const durationSeconds = element.duration_in_traffic ? element.duration_in_traffic.value : element.duration.value;
            const travelTimeMinutes = Math.round(durationSeconds / 60);

            resolve({ 
                distance: distanceMiles, 
                travelTime: travelTimeMinutes,
                distanceText: element.distance.text,
                durationText: element.duration_in_traffic ? element.duration_in_traffic.text : element.duration.text
            });
        });
    });
};

/**
 * Calculates total round trip distance using Google Maps:
 * Origin -> Destination -> Landfill -> Origin
 */
export const calculateRoundTripDistance = async (customerAddressStr) => {
    try {
        await loadGoogleMaps();
    } catch (err) {
        throw new Error(`Google Maps not loaded: ${err.message}`);
    }

    const origin = await getBusinessAddress();
    const customer = customerAddressStr;
    const landfill = LANDFILL_LOCATION;

    console.log(`[DistanceHelper] Round-Trip Route Request:`);
    console.log(`1. Business -> Customer: ${origin} -> ${customer}`);
    console.log(`2. Customer -> Landfill: ${customer} -> ${landfill}`);
    console.log(`3. Landfill -> Business: ${landfill} -> ${origin}`);

    return new Promise((resolve, reject) => {
        if (!window.google || !window.google.maps || !window.google.maps.DistanceMatrixService) {
            return reject(new Error("Google Maps API is unavailable."));
        }

        const service = new window.google.maps.DistanceMatrixService();
        
        service.getDistanceMatrix({
            origins: [origin, customer, landfill],
            destinations: [customer, landfill, origin],
            travelMode: window.google.maps.TravelMode.DRIVING,
            unitSystem: window.google.maps.UnitSystem.IMPERIAL,
        }, (response, status) => {
            if (status !== window.google.maps.DistanceMatrixStatus.OK) {
                console.error("[DistanceHelper] Matrix API failed:", status);
                return reject(new Error(`Google Maps API call failed: ${status}`));
            }

            try {
                // Leg 1: Origin -> Customer
                const leg1 = response.rows[0].elements[0];
                // Leg 2: Customer -> Landfill
                const leg2 = response.rows[1].elements[1];
                // Leg 3: Landfill -> Origin
                const leg3 = response.rows[2].elements[2];

                if (leg1.status !== 'OK' || leg2.status !== 'OK' || leg3.status !== 'OK') {
                    console.error("[DistanceHelper] Route leg failed:", { leg1: leg1.status, leg2: leg2.status, leg3: leg3.status });
                    return reject(new Error("Could not calculate one or more route legs. Please verify the address."));
                }

                const d1 = parseFloat((leg1.distance.value / 1609.34).toFixed(1));
                const d2 = parseFloat((leg2.distance.value / 1609.34).toFixed(1));
                const d3 = parseFloat((leg3.distance.value / 1609.34).toFixed(1));

                console.log(`[DistanceHelper] Leg Distances: Business->Customer=${d1}mi, Customer->Landfill=${d2}mi, Landfill->Business=${d3}mi`);

                // Sum all values
                const totalMiles = parseFloat((d1 + d2 + d3).toFixed(1));
                console.log(`[DistanceHelper] Total Round-Trip Distance: ${totalMiles} miles`);

                resolve(totalMiles);
            } catch (err) {
                console.error("[DistanceHelper] Parsing response failed:", err);
                reject(err);
            }
        });
    });
};

/**
 * Calculates distance to a customer's address and saves it to the database
 */
export const calculateAndSaveDistanceFrontend = async (customer) => {
    const address = formatFullAddress(customer);
    
    if (!address) {
        return { distance: null, travelTime: null, error: 'Incomplete address provided.' };
    }

    try {
        const origin = await getBusinessAddress();
        const result = await calculateDistanceViaGoogleMaps(origin, address);

        // Update the customer record in the database
        const { error: updateError } = await supabase
            .from('customers')
            .update({ 
                distance_miles: result.distance,
                travel_time_minutes: result.travelTime
            })
            .eq('id', customer.id);

        if (updateError) {
            console.error("Failed to update customer with distance data:", updateError);
            throw updateError;
        }

        return { 
            distance: result.distance, 
            travelTime: result.travelTime, 
            error: null 
        };
    } catch (err) {
        console.error("Distance calculation error:", err);
        return { distance: null, travelTime: null, error: err.message };
    }
};