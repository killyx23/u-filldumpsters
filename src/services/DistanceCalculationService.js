import { calculateDeliveryRoute } from '../utils/distanceCalculationHelper';
import {
  includedDeliveryMileageExplanation,
  resolveIncludedDeliveryMiles,
} from '../utils/chargesAndFeesConfig';
import { chargeMileageBands, mileageBandCacheKey, resolveMileageBands } from '../utils/mileageBands';

export const trailerDeliveryMileageExplanation = includedDeliveryMileageExplanation;

export const TRAILER_DYNAMIC_PRICING_NOTE =
    "This is dynamic pricing, set to stay competitive and to save you a couple plus hours you would otherwise spend.";

export const TRAILER_GREATER_RANGE_NOTE =
    "Adding a mileage fee lets us reach farther distances at a competitive price, so we can offer our convenient delivery services to the greater valley.";

function formatMileCount(miles) {
    const rounded = Math.round(Math.max(0, Number(miles) || 0) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Customer-facing mileage line. Overage is billed separately from this sentence. */
export function formatTrailerDeliveryMileage({ deliveryMiles }) {
    return `Mileage to delivery is ${formatMileCount(deliveryMiles)} miles.`;
}

/** Included miles of the drive to the customer are free. Every mile past that is charged at the mileage rate. */
export function trailerDeliveryChargeableMiles(route, includedMiles) {
    const businessToCustomer = Math.max(0, Number(route?.businessToCustomer) || 0);
    const customerToLandfill = Math.max(0, Number(route?.customerToLandfill) || 0);
    const included = resolveIncludedDeliveryMiles(includedMiles);
    const chargeableDistance = Math.max(0, Number((businessToCustomer - included).toFixed(1)));
    return { businessToCustomer, customerToLandfill, includedMiles: included, chargeableDistance };
}

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
export const calculateDistanceAndFee = (distance, planId, dbRate = null, route = null, includedMiles, mileageBands = null) => {
    const numericPlanId = Number(planId);
    const feePerMile = dbRate !== null && dbRate !== undefined ? Number(dbRate) : 0.85;
    const included = resolveIncludedDeliveryMiles(includedMiles);
    const trailerSplit = numericPlanId === 4 && route ? trailerDeliveryChargeableMiles(route, included) : null;
    const bands = resolveMileageBands({ ...(mileageBands || {}), mileage_rate: feePerMile });

    if ((!distance || distance <= 0) && !trailerSplit) {
        return { distance: 0, total_distance: 0, total_miles: 0, measuredMiles: 0, feePerMile: 0, mileage_rate: 0, freeDistance: 0, chargeableDistance: 0, totalFee: 0, mileage_charge: 0, trip_mileage_cost: 0, displayText: '' };
    }
    
    // Dumpster (1) includes the first included miles of the full route.
    // Dump trailer delivery (4) includes the first included miles to the delivery address.
    const measuredMiles = trailerSplit ? trailerSplit.businessToCustomer : Number(distance) || 0;
    const freeDistance = trailerSplit ? trailerSplit.includedMiles : (numericPlanId === 1 ? included : 0);
    
    const chargeableDistance = trailerSplit
        ? trailerSplit.chargeableDistance
        : Math.max(0, measuredMiles - freeDistance);
    
    // Free miles, then the first rate, then the second rate, then the third rate.
    const trip_mileage_cost = chargeMileageBands(measuredMiles, freeDistance, { ...(mileageBands || {}), mileage_rate: feePerMile });
    
    console.log(`[DistanceCalculation] Plan ID: ${planId}, Total Distance: ${distance}mi, Free: ${freeDistance}mi, Chargeable: ${chargeableDistance}mi, Rates: $${bands.rate1}/$${bands.rate2}/$${bands.rate3}, Trip Mileage Cost: $${trip_mileage_cost}`);

    let displayText = '';
    if (numericPlanId === 4) {
        displayText = formatTrailerDeliveryMileage({
            deliveryMiles: trailerSplit ? trailerSplit.businessToCustomer : distance,
            chargeableDistance,
            mileageCharge: trip_mileage_cost,
        });
    } else if (numericPlanId === 1 && freeDistance > 0) {
        displayText = `Mileage Charge: $${trip_mileage_cost.toFixed(2)} (${distance.toFixed(2)} miles total, ${freeDistance} miles free, $${feePerMile.toFixed(2)}/mile)`;
    } else {
        displayText = `Mileage Charge: $${trip_mileage_cost.toFixed(2)} (${distance.toFixed(2)} miles total, $${feePerMile.toFixed(2)}/mile)`;
    }
    
    return {
        distance,
        total_distance: distance,
        total_miles: distance,
        measuredMiles,
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
export const fetchDistanceAndCalculateFee = async (address, planId, dbRate, includedMiles, mileageBands = null) => {
    if (!address) return { error: "Address is required" };
    const included = resolveIncludedDeliveryMiles(includedMiles);
    const bands = { ...(mileageBands || {}), mileage_rate: dbRate };
    
    const addressStr = typeof address === 'string' 
        ? address 
        : `${address.street}, ${address.city}, ${address.state} ${address.zip}`;
    
    const cacheKey = `${addressStr}_${planId}_${mileageBandCacheKey(bands)}_${included}`;
    if (cache.has(cacheKey)) {
        console.log(`[DistanceCalculation] Using cached result for: ${cacheKey}`);
        return cache.get(cacheKey);
    }

    try {
        console.log(`[DistanceCalculation] Fetching distance for: ${addressStr}`);
        // calculateRoundTripDistance internal logic uses business_settings for origin
        const route = await calculateDeliveryRoute(addressStr);
        const totalDistanceMiles = route.totalMiles;
        
        const feeData = calculateDistanceAndFee(totalDistanceMiles, planId, dbRate, route, included, mileageBands);

        const result = {
            distance: totalDistanceMiles,
            total_distance: totalDistanceMiles,
            total_miles: totalDistanceMiles,
            measuredMiles: feeData.measuredMiles,
            deliveryRoute: route,
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