
import { differenceInDays, differenceInHours, parseISO, isValid } from 'date-fns';

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

export const calculateDays = (dropOff, pickup) => {
    if (!dropOff || !pickup) return 1;
    const start = typeof dropOff === 'string' ? parseISO(dropOff) : dropOff;
    const end = typeof pickup === 'string' ? parseISO(pickup) : pickup;
    
    if (!isValid(start) || !isValid(end)) return 1;
    
    const days = differenceInDays(end, start) + 1;
    return Math.max(1, days);
};

export const calculateBookingCosts = (service, days, addonsList, distanceMiles = 0) => {
    if (!service) {
        return { serviceCost: 0, addonsCost: 0, subtotal: 0, tax: 0, total: 0 };
    }

    const basePrice = Number(service.base_price) || 0;
    const deliveryFee = Number(service.delivery_fee) || 0;
    const mileageRate = Number(service.mileage_rate) || 0.85;
    
    // Calculate service cost using exact BookingForm logic
    let serviceCost = 0;
    if (service.id === 1) {
        // 16 Yard Dumpster: 7 days = $500, otherwise base_price + (days-1) * $50
        serviceCost = days === 7 ? 500 : basePrice + Math.max(0, days - 1) * 50;
    } else if (service.id === 2 || service.id === 4) {
        // Dump Loader Trailer or with Delivery: base_price * days
        serviceCost = basePrice * days;
    } else if (service.id === 3) {
        // Flat Bed Delivery: just base_price (single day)
        serviceCost = basePrice;
    }

    // Add delivery fee for delivery services
    const isDeliveryService = service.id === 1 || service.id === 4 || service.id === 3;
    if (isDeliveryService) {
        serviceCost += deliveryFee;
    }

    // Add mileage charge for delivery services (round-trip)
    let mileageCharge = 0;
    if (isDeliveryService && distanceMiles > 0) {
        mileageCharge = distanceMiles * 2 * mileageRate;
        serviceCost += mileageCharge;
    }

    // Calculate add-ons cost
    let addonsCost = 0;
    if (Array.isArray(addonsList)) {
        addonsCost = addonsList.reduce((sum, addon) => {
            const price = Number(addon?.price || 0);
            const qty = Number(addon?.quantity || 1);
            return sum + (price * qty);
        }, 0);
    } else if (addonsList && typeof addonsList === 'object') {
        addonsCost = Object.values(addonsList).reduce((sum, val) => {
            const p = Number(val?.price || val) || 0;
            const q = Number(val?.quantity || 1);
            return sum + (p * q);
        }, 0);
    }

    const subtotal = serviceCost + addonsCost;
    const tax = subtotal * 0.07; // 7% tax (exactly like BookingForm)
    const total = subtotal + tax;

    return {
        serviceCost: round2(serviceCost),
        addonsCost: round2(addonsCost),
        mileageCharge: round2(mileageCharge),
        subtotal: round2(subtotal),
        tax: round2(tax),
        total: round2(total)
    };
};

export const calculateRescheduleDifference = (originalCosts, newCosts) => {
    const originalTotal = Number(originalCosts?.total) || 0;
    const newTotal = Number(newCosts?.total) || 0;
    const difference = newTotal - originalTotal;
    
    return {
        difference: round2(difference),
        finalAmountDue: round2(difference)
    };
};

export const calculateRescheduleFee = (originalTotal, originalApptTime, requestTime) => {
    const baseTotal = Number(originalTotal) || 0;
    if (!baseTotal || !originalApptTime || !requestTime) {
        return { feeApplies: false, feeAmount: 0, newTotal: baseTotal, timeDifferenceHours: 999 };
    }

    const apptDate = typeof originalApptTime === 'string' ? parseISO(originalApptTime) : originalApptTime;
    const reqDate = typeof requestTime === 'string' ? parseISO(requestTime) : requestTime;

    if (!isValid(apptDate) || !isValid(reqDate)) {
         return { feeApplies: false, feeAmount: 0, newTotal: baseTotal, timeDifferenceHours: 999 };
    }

    const timeDifferenceHours = differenceInHours(apptDate, reqDate);
    const feeApplies = timeDifferenceHours < 24 && timeDifferenceHours >= 0;
    
    const feeAmount = feeApplies ? (baseTotal * 0.05) : 0;
    
    return {
        feeApplies,
        feeAmount: round2(feeAmount),
        newTotal: round2(baseTotal + feeAmount),
        timeDifferenceHours
    };
};

/**
 * Calculate inventory differences between original and new add-ons
 * Returns arrays of items to return and items to allocate
 */
export const calculateAddonsDifference = (originalAddons = [], newAddons = []) => {
    const originalMap = new Map();
    const newMap = new Map();
    
    // Build maps by equipment ID
    originalAddons.forEach(addon => {
        const key = addon.id || addon.equipment_id;
        originalMap.set(key, {
            ...addon,
            quantity: Number(addon.quantity || 1)
        });
    });
    
    newAddons.forEach(addon => {
        const key = addon.id || addon.equipment_id;
        newMap.set(key, {
            ...addon,
            quantity: Number(addon.quantity || 1)
        });
    });
    
    const toReturn = []; // Items removed or quantity decreased
    const toAllocate = []; // Items added or quantity increased
    const unchanged = []; // Items with same quantity
    
    // Check all original items
    originalMap.forEach((originalItem, id) => {
        const newItem = newMap.get(id);
        
        if (!newItem) {
            // Item completely removed - return to inventory
            toReturn.push({
                equipment_id: id,
                name: originalItem.name,
                quantity: originalItem.quantity,
                type: originalItem.type
            });
        } else if (newItem.quantity < originalItem.quantity) {
            // Quantity decreased - return difference
            toReturn.push({
                equipment_id: id,
                name: originalItem.name,
                quantity: originalItem.quantity - newItem.quantity,
                type: originalItem.type
            });
        } else if (newItem.quantity > originalItem.quantity) {
            // Quantity increased - allocate difference
            toAllocate.push({
                equipment_id: id,
                name: newItem.name,
                quantity: newItem.quantity - originalItem.quantity,
                type: newItem.type
            });
        } else {
            // Same quantity
            unchanged.push({
                equipment_id: id,
                name: originalItem.name,
                quantity: originalItem.quantity,
                type: originalItem.type
            });
        }
    });
    
    // Check for completely new items
    newMap.forEach((newItem, id) => {
        if (!originalMap.has(id)) {
            toAllocate.push({
                equipment_id: id,
                name: newItem.name,
                quantity: newItem.quantity,
                type: newItem.type
            });
        }
    });
    
    return {
        toReturn,
        toAllocate,
        unchanged
    };
};

export function calculateComprehensivePricing(
  serviceId,
  basePrice,
  numberOfDays,
  selectedAddons = [],
  mileageDistance = 0,
  deliveryFee = 0,
  insurancePrice = 0
) {
  // Calculate base rental cost based on service type
  let baseRentalCost = 0;
  
  if (serviceId === 1) {
    // Service 1 (16 Yard Dumpster): 7 days = $500, else base_price + (days-1) × $50
    if (numberOfDays === 7) {
      baseRentalCost = 500;
    } else {
      baseRentalCost = basePrice + (numberOfDays - 1) * 50;
    }
  } else if (serviceId === 2) {
    // Service 2 (Dump Loader Trailer): base_price × days
    baseRentalCost = basePrice * numberOfDays;
  } else if (serviceId === 3) {
    // Service 3 (Flat Bed Delivery): base_price (single day)
    baseRentalCost = basePrice;
  } else if (serviceId === 4) {
    // Service 4 (Dump Loader with Delivery): base_price × days
    baseRentalCost = basePrice * numberOfDays;
  } else {
    // Default: base_price × days
    baseRentalCost = basePrice * numberOfDays;
  }

  // Calculate mileage charge (round-trip distance × rate)
  const mileageCharge = mileageDistance > 0 ? mileageDistance * 0.5 : 0; // Assuming $0.50 per mile; adjust if needed

  // Calculate add-ons breakdown
  const addonsBreakdown = selectedAddons
    .filter(addon => addon.quantity > 0)
    .map(addon => ({
      name: addon.name,
      price: addon.price,
      quantity: addon.quantity,
      total: addon.price * addon.quantity
    }));

  const addonsTotal = addonsBreakdown.reduce((sum, addon) => sum + addon.total, 0);

  // Calculate subtotal (before tax)
  const subtotal = baseRentalCost + deliveryFee + mileageCharge + addonsTotal + insurancePrice;

  // Calculate tax (7%)
  const tax = subtotal * 0.07;

  // Calculate estimated total
  const estimatedTotal = subtotal + tax;

  return {
    baseRentalCost,
    deliveryFee,
    mileageCharge,
    addonsBreakdown,
    insurancePrice,
    subtotal,
    tax,
    estimatedTotal
  };
}
