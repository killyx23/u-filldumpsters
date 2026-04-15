
import { differenceInCalendarDays, differenceInHours, parseISO, isValid } from 'date-fns';

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

export const calculateDays = (dropOff, pickup) => {
    if (!dropOff || !pickup) return 1;
    const start = typeof dropOff === 'string' ? parseISO(dropOff) : dropOff;
    const end = typeof pickup === 'string' ? parseISO(pickup) : pickup;
    
    if (!isValid(start) || !isValid(end)) return 1;
    
    // Add 1 to make the calculation inclusive of both start and end dates
    const days = differenceInCalendarDays(end, start) + 1;
    return Math.max(1, days);
};

export const calculateBookingCosts = (service, days, addonsList, distanceMiles = 0) => {
    if (!service) {
        return { serviceCost: 0, addonsCost: 0, subtotal: 0, tax: 0, total: 0 };
    }

    const basePrice = Number(service.base_price) || 0;
    const deliveryFee = Number(service.delivery_fee) || 0;
    const mileageRate = Number(service.mileage_rate) || 0;
    const dailyRate = Number(service.daily_rate) || 0;
    
    const isDelivery = service.service_type === 'delivery' || String(service.name).toLowerCase().includes('delivery');

    let serviceCost = 0;
    if (isDelivery) {
        serviceCost = (basePrice * days) + deliveryFee + (mileageRate * (Number(distanceMiles) * 2));
    } else {
        serviceCost = dailyRate > 0 ? (basePrice + (dailyRate * Math.max(0, days - 1))) : (basePrice * days);
    }

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
    const tax = subtotal * 0.07;
    const total = subtotal + tax;

    return {
        serviceCost: round2(serviceCost),
        addonsCost: round2(addonsCost),
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
    
    // 5% reschedule fee if within 24 hours
    const feeAmount = feeApplies ? (baseTotal * 0.05) : 0;
    
    return {
        feeApplies,
        feeAmount: round2(feeAmount),
        newTotal: round2(baseTotal + feeAmount),
        timeDifferenceHours
    };
};

export const calculateComprehensivePricing = async (
    bookingData, 
    newServiceData, 
    rescheduleDate, 
    newPickupDate, 
    selectedAddonsObj = null,
    distanceMiles = 0
) => {
    const originalTotal = Number(bookingData?.total_price) || 0;
    
    // Estimate original pre-tax breakdown strictly to avoid bad math logic
    const preTaxOriginal = originalTotal / 1.07;
    
    let originalAddonsCost = 0;
    if (bookingData?.addons) {
        if (Array.isArray(bookingData.addons)) {
            originalAddonsCost = bookingData.addons.reduce((sum, val) => sum + (Number(val?.price || 0) * Number(val?.quantity || 1)), 0);
        } else {
            originalAddonsCost = Object.values(bookingData.addons).reduce((sum, val) => {
                const p = Number(val?.price || val) || 0;
                const q = Number(val?.quantity || 1);
                return sum + (p * q);
            }, 0);
        }
    }
    
    const originalServiceCost = Math.max(0, preTaxOriginal - originalAddonsCost);

    // Calculate new costs
    let newDays = 1;
    if (rescheduleDate && newPickupDate) {
        newDays = calculateDays(rescheduleDate, newPickupDate);
    }

    let newServiceCost = originalServiceCost;
    let newAddonsCost = originalAddonsCost;
    let newSubtotal = 0;
    let taxAmount = 0;
    let newTotalWithTax = 0;

    if (newServiceData || selectedAddonsObj) {
        // If we have proper structures, calculate cleanly through calculateBookingCosts
        const activeAddons = selectedAddonsObj || bookingData?.addons || [];
        const activeService = newServiceData || bookingData?.plan || null;
        
        const costs = calculateBookingCosts(activeService, newDays, activeAddons, distanceMiles);
        
        newServiceCost = costs.serviceCost;
        newAddonsCost = costs.addonsCost;
        newSubtotal = costs.subtotal;
        taxAmount = costs.tax;
        newTotalWithTax = costs.total;
    } else {
        newSubtotal = newServiceCost + newAddonsCost;
        taxAmount = newSubtotal * 0.07;
        newTotalWithTax = newSubtotal + taxAmount;
    }

    const serviceDifference = newServiceCost - originalServiceCost;
    const finalAmountDue = newTotalWithTax - originalTotal;

    return {
        originalServiceCost: round2(originalServiceCost),
        originalAddonsCost: round2(originalAddonsCost),
        originalTotal: round2(originalTotal),
        newServiceCost: round2(newServiceCost),
        serviceDifference: round2(serviceDifference),
        newAddonsCost: round2(newAddonsCost),
        newSubtotal: round2(newSubtotal),
        taxAmount: round2(taxAmount),
        finalAmountDue: round2(finalAmountDue),
        newTotalWithTax: round2(newTotalWithTax)
    };
};
