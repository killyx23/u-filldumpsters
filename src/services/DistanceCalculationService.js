
import { calculateRoundTripDistance } from '../utils/distanceCalculationHelper';

const cache = new Map();

/**
 * Calculates plan-specific delivery distance fees.
 * Applies different business rules based on the selected plan.
 * 
 * @param {number} distance - Total calculated round-trip distance in miles
 * @param {number} planId - ID of the selected service plan
 * @param {number} dbRate - Mileage rate fetched from the DB (defaults to 20 if omitted)
 * @returns {Object} Fee calculation details and display strings
 */
export const calculateDistanceAndFee = (distance, planId, dbRate = null) => {
    if (!distance || distance <= 0) {
        return { distance: 0, feePerMile: 0, freeDistance: 0, chargeableDistance: 0, totalFee: 0, displayText: '' };
    }
    
    // Default to $20/mile if no dbRate is given, as required by pricing rules.
    const feePerMile = dbRate !== null && dbRate !== undefined ? Number(dbRate) : 20;
    
    // Apply plan-specific business rules
    // Plan 1: 16 Yard Dumpster (first 30 miles are free)
    // Plan 2/3/4: Dump Loader Trailer variants (0 free miles)
    const freeDistance = planId === 1 ? 30 : 0;
    
    // Ensure we don't charge for negative distances if under the free limit
    const chargeableDistance = Math.max(0, distance - freeDistance);
    const totalFee = chargeableDistance * feePerMile;
    
    let displayText = '';
    if (planId === 1) {
        displayText = `Mileage Fee: $${totalFee.toFixed(2)} (${distance.toFixed(1)} miles total, 30 miles free, $${feePerMile.toFixed(2)}/mile)`;
    } else {
        displayText = `Mileage Fee: $${totalFee.toFixed(2)} (${distance.toFixed(1)} miles total, $${feePerMile.toFixed(2)}/mile)`;
    }
    
    return {
        distance,
        feePerMile,
        freeDistance,
        chargeableDistance,
        totalFee,
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
        return cache.get(cacheKey);
    }

    try {
        // Calculate total routing: Origin -> Destination -> Landfill -> Origin
        const totalDistanceMiles = await calculateRoundTripDistance(addressStr);
        
        const feeData = calculateDistanceAndFee(totalDistanceMiles, planId, dbRate);

        const result = {
            distance: totalDistanceMiles,
            mileageFee: feeData.totalFee,
            totalFee: feeData.totalFee,
            distanceFeeDisplay: feeData.displayText
        };

        cache.set(cacheKey, result);
        return result;
    } catch (e) {
        console.error("[DistanceCalculationService] Error:", e);
        return { error: e.message || "Failed to calculate distance service route." };
    }
};
