
import { differenceInDays, differenceInHours, parseISO, isValid } from 'date-fns';
import { getPriceForEquipment, getPriceFromSnapshotOrCurrent } from './equipmentPricingIntegration';

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

export const calculateDays = (dropOff, pickup) => {
    if (!dropOff || !pickup) return 1;
    const start = typeof dropOff === 'string' ? parseISO(dropOff) : dropOff;
    const end = typeof pickup === 'string' ? parseISO(pickup) : pickup;
    
    if (!isValid(start) || !isValid(end)) return 1;
    
    const days = differenceInDays(end, start) + 1;
    return Math.max(1, days);
};

export const calculateBookingCosts = async (service, days, addonsList, distanceMiles = 0, priceSnapshot = null) => {
    if (!service) {
        return { serviceCost: 0, addonsCost: 0, subtotal: 0, tax: 0, total: 0 };
    }

    const basePrice = Number(service.base_price) || 0;
    const deliveryFee = Number(service.delivery_fee) || 0;
    const mileageRate = Number(service.mileage_rate) || 0.85;
    
    // Calculate service cost
    let serviceCost = 0;
    if (service.id === 1) {
        serviceCost = days === 7 ? 500 : basePrice + Math.max(0, days - 1) * 50;
    } else if (service.id === 2 || service.id === 4) {
        serviceCost = basePrice * days;
    } else if (service.id === 3) {
        serviceCost = basePrice;
    }

    // Add delivery fee
    const isDeliveryService = service.id === 1 || service.id === 4 || service.id === 3;
    if (isDeliveryService) {
        serviceCost += deliveryFee;
    }

    // Add mileage charge
    let mileageCharge = 0;
    if (isDeliveryService && distanceMiles > 0) {
        mileageCharge = distanceMiles * 2 * mileageRate;
        serviceCost += mileageCharge;
    }

    // Calculate add-ons cost using equipment_pricing
    let addonsCost = 0;
    if (Array.isArray(addonsList)) {
        for (const addon of addonsList) {
            const equipmentId = addon.equipment_id || addon.dbId || addon.id;
            if (equipmentId) {
                const price = await getPriceFromSnapshotOrCurrent(equipmentId, priceSnapshot);
                const qty = Number(addon?.quantity || 1);
                addonsCost += price * qty;
            } else {
                // Fallback to addon.price if no equipment_id
                const price = Number(addon?.price || 0);
                const qty = Number(addon?.quantity || 1);
                addonsCost += price * qty;
            }
        }
    } else if (addonsList && typeof addonsList === 'object') {
        for (const [key, val] of Object.entries(addonsList)) {
            const p = Number(val?.price || val) || 0;
            const q = Number(val?.quantity || 1);
            addonsCost += p * q;
        }
    }

    const subtotal = serviceCost + addonsCost;
    const tax = subtotal * 0.07;
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

export const calculateAddonsDifference = async (originalAddons = [], newAddons = [], priceSnapshot = null) => {
    const originalMap = new Map();
    const newMap = new Map();
    
    // Build maps with current prices
    for (const addon of originalAddons) {
        const key = addon.id || addon.equipment_id;
        const price = await getPriceFromSnapshotOrCurrent(key, priceSnapshot);
        originalMap.set(key, {
            ...addon,
            quantity: Number(addon.quantity || 1),
            price
        });
    }
    
    for (const addon of newAddons) {
        const key = addon.id || addon.equipment_id;
        const price = await getPriceFromSnapshotOrCurrent(key, priceSnapshot);
        newMap.set(key, {
            ...addon,
            quantity: Number(addon.quantity || 1),
            price
        });
    }
    
    const toReturn = [];
    const toAllocate = [];
    const unchanged = [];
    
    originalMap.forEach((originalItem, id) => {
        const newItem = newMap.get(id);
        
        if (!newItem) {
            toReturn.push({
                equipment_id: id,
                name: originalItem.name,
                quantity: originalItem.quantity,
                type: originalItem.type,
                price: originalItem.price
            });
        } else if (newItem.quantity < originalItem.quantity) {
            toReturn.push({
                equipment_id: id,
                name: originalItem.name,
                quantity: originalItem.quantity - newItem.quantity,
                type: originalItem.type,
                price: originalItem.price
            });
        } else if (newItem.quantity > originalItem.quantity) {
            toAllocate.push({
                equipment_id: id,
                name: newItem.name,
                quantity: newItem.quantity - originalItem.quantity,
                type: newItem.type,
                price: newItem.price
            });
        } else {
            unchanged.push({
                equipment_id: id,
                name: originalItem.name,
                quantity: originalItem.quantity,
                type: originalItem.type,
                price: originalItem.price
            });
        }
    });
    
    newMap.forEach((newItem, id) => {
        if (!originalMap.has(id)) {
            toAllocate.push({
                equipment_id: id,
                name: newItem.name,
                quantity: newItem.quantity,
                type: newItem.type,
                price: newItem.price
            });
        }
    });
    
    return {
        toReturn,
        toAllocate,
        unchanged
    };
};

export async function calculateComprehensivePricing(
  serviceId,
  basePrice,
  numberOfDays,
  selectedAddons = [],
  mileageDistance = 0,
  deliveryFee = 0,
  insurancePrice = 0,
  priceSnapshot = null
) {
  let baseRentalCost = 0;
  
  if (serviceId === 1) {
    baseRentalCost = numberOfDays === 7 ? 500 : basePrice + (numberOfDays - 1) * 50;
  } else if (serviceId === 2) {
    baseRentalCost = basePrice * numberOfDays;
  } else if (serviceId === 3) {
    baseRentalCost = basePrice;
  } else if (serviceId === 4) {
    baseRentalCost = basePrice * numberOfDays;
  } else {
    baseRentalCost = basePrice * numberOfDays;
  }

  const mileageCharge = mileageDistance > 0 ? mileageDistance * 0.5 : 0;

  // Calculate add-ons using equipment_pricing
  const addonsBreakdown = [];
  for (const addon of selectedAddons.filter(a => a.quantity > 0)) {
    const equipmentId = addon.equipment_id || addon.dbId || addon.id;
    let price = Number(addon.price || 0);
    
    if (equipmentId) {
      price = await getPriceFromSnapshotOrCurrent(equipmentId, priceSnapshot);
    }
    
    addonsBreakdown.push({
      name: addon.name,
      price,
      quantity: addon.quantity,
      total: price * addon.quantity
    });
  }

  const addonsTotal = addonsBreakdown.reduce((sum, addon) => sum + addon.total, 0);
  const subtotal = baseRentalCost + deliveryFee + mileageCharge + addonsTotal + insurancePrice;
  const tax = subtotal * 0.07;
  const estimatedTotal = subtotal + tax;

  return {
    baseRentalCost: round2(baseRentalCost),
    deliveryFee: round2(deliveryFee),
    mileageCharge: round2(mileageCharge),
    addonsBreakdown,
    insurancePrice: round2(insurancePrice),
    subtotal: round2(subtotal),
    tax: round2(tax),
    estimatedTotal: round2(estimatedTotal)
  };
}
