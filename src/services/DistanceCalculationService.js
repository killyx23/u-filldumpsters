import { calculateRoundTripDistance } from '../utils/distanceCalculationHelper';

const cache = new Map();

/**
 * Calculates plan-specific delivery distance fees.
 * Applies different business rules based on the selected plan.
 * 
 * @param {number} distance - Total calculated round-trip distance in miles
 * @param {number} planId - ID of the selected service plan
 * @param {number} dbRate - Mileage rate fetched from the DB (defaults to 0.85 if omitted)
 * @returns {Object} Fee calculation details and display strings
 */
export const calculateDistanceAndFee = (distance, planId, dbRate = null) => {
    if (!distance || distance <= 0) {
        return { distance: 0, total_distance: 0, total_miles: 0, feePerMile: 0, mileage_rate: 0, freeDistance: 0, chargeableDistance: 0, totalFee: 0, mileage_charge: 0, trip_mileage_cost: 0, displayText: '' };
    }
    
    const feePerMile = dbRate !== null && dbRate !== undefined ? Number(dbRate) : 0.85;
    
    // Set free miles strictly based on plan.
    const freeDistance = planId === 1 ? 30 : 0;
    
    const chargeableDistance = Math.max(0, distance - freeDistance);
    
    // trip_mileage_cost calculation (strictly miles * rate, NO flat fees mixed in)
    const trip_mileage_cost = feePerMile > 0 ? chargeableDistance * feePerMile : 0;
    
    console.log(`[DistanceCalculation] Plan ID: ${planId}, Total Distance: ${distance}mi, Free: ${freeDistance}mi, Chargeable: ${chargeableDistance}mi, Rate: $${feePerMile}/mi, Trip Mileage Cost: $${trip_mileage_cost}`);

    let displayText = '';
    if (planId === 1 && freeDistance > 0) {
        displayText = `Mileage Charge: $${trip_mileage_cost.toFixed(2)} (${distance.toFixed(2)} miles total, ${freeDistance} miles free, $${feePerMile.toFixed(2)}/mile)`;
    } else {
        displayText = `Mileage Charge: $${trip_mileage_cost.toFixed(2)} (${distance.toFixed(2)} miles total, $${feePerMile.toFixed(2)}/mile)`;
    }
    
    return {
        distance,
        total_distance: distance,
        total_miles: distance,
        feePerMile,
        mileage_rate: feePerMile,
        freeDistance,
        chargeableDistance,
        totalFee: trip_mileage_cost,
        mileage_charge: trip_mileage_cost,
        trip_mileage_cost: trip_mileage_cost,
        displayText
    };
};

/**
 * Main wrapper to fetch distance from Google Maps and calculate the final fee.
 * Includes caching for repeated exact address queries.
 * 
 * @param {Object|string} address - The verified address object or string
 * @param {number} planId - ID of the selected service plan
 * @param {number} dbRate - Mileage rate fetched from the DB
 * @returns {Promise<Object>} Final calculated distance and fee object
 */
export const fetchDistanceAndCalculateFee = async (address, planId, dbRate) => {
    if (!address) return { error: "Address is required" };
    
    const addressStr = typeof address === 'string' 
        ? address 
        : `${address.street}, ${address.city}, ${address.state} ${address.zip}`;
    
    const cacheKey = `${addressStr}_${planId}_${dbRate}`;
    if (cache.has(cacheKey)) {
        console.log(`[DistanceCalculation] Using cached result for: ${cacheKey}`);
        return cache.get(cacheKey);
    }

    try {
        console.log(`[DistanceCalculation] Fetching distance for: ${addressStr}`);
        // calculateRoundTripDistance internal logic uses business_settings for origin
        const totalDistanceMiles = await calculateRoundTripDistance(addressStr);
        
        const feeData = calculateDistanceAndFee(totalDistanceMiles, planId, dbRate);

        const result = {
            distance: totalDistanceMiles,
            total_distance: totalDistanceMiles,
            total_miles: totalDistanceMiles,
            mileageFee: feeData.trip_mileage_cost,
            mileage_charge: feeData.trip_mileage_cost,
            totalFee: feeData.trip_mileage_cost,
            trip_mileage_cost: feeData.trip_mileage_cost,
            distanceFeeDisplay: feeData.displayText
        };

        cache.set(cacheKey, result);
        return result;
    } catch (e) {
        console.error("[DistanceCalculationService] Error:", e);
        return { error: e.message || "Failed to calculate distance service route." };
    }
};