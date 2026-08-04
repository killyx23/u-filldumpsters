import { differenceInDays, differenceInHours, parseISO, isValid } from 'date-fns';
import { getPriceFromSnapshotOrCurrent } from './equipmentPricingIntegration';
import { isValidEquipmentId } from './equipmentIdValidator';
import { getTaxRate } from './getTaxRate';
import { supabase } from '@/lib/customSupabaseClient';

const INSURANCE_SERVICE_EQUIPMENT_ID = 7;
const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

/** Premium Insurance was purchased (not merely present as "decline" on the addons JSON). */
export function bookingHadInsurance(addons) {
    if (!addons || typeof addons !== 'object') return false;
    if (addons.insurance === 'accept') return true;
    if (Number(addons.insurancePriceApplied) > 0) return true;
    return false;
}

export function isInsuranceAddon(addon) {
    if (!addon) return false;
    if (addon.id === 'insurance' || addon.type === 'insurance') return true;
    const name = (addon.name || '').toLowerCase();
    return name.includes('premium insurance');
}

/** Numeric equipment id 1–6 only (excludes insurance service id 7 and string slugs). */
export function resolveNumericEquipmentId(addon) {
    const raw = addon?.equipment_id ?? addon?.dbId ?? addon?.id;
    const numericId = Number(raw);
    if (!isValidEquipmentId(numericId) || numericId === INSURANCE_SERVICE_EQUIPMENT_ID) {
        return null;
    }
    return numericId;
}

function addonMapKey(addon) {
    if (isInsuranceAddon(addon)) return 'insurance';
    const numericId = resolveNumericEquipmentId(addon);
    if (numericId != null) return numericId;
    return addon?.id ?? addon?.equipment_id ?? addon?.name ?? 'unknown';
}

export async function resolveAddonUnitPrice(addon, priceSnapshot = null) {
    if (isInsuranceAddon(addon)) {
        return Number(addon?.price || 0);
    }
    const equipmentId = resolveNumericEquipmentId(addon);
    if (equipmentId) {
        return await getPriceFromSnapshotOrCurrent(equipmentId, priceSnapshot);
    }
    return Number(addon?.price || 0);
}

/** Build original add-on list from booking_equipment rows and addons JSON fallback. */
export function buildOriginalAddonsList(booking, bookingEquip = [], allEquipment = [], insuranceFallbackPrice = 25) {
    const list = [];
    const seenIds = new Set();

    for (const be of bookingEquip || []) {
        const equipId = be.equipment_id ?? be.equipment?.id;
        if (!equipId || equipId === INSURANCE_SERVICE_EQUIPMENT_ID || seenIds.has(equipId)) continue;
        seenIds.add(equipId);
        list.push({
            id: equipId,
            equipment_id: equipId,
            name: be.equipment?.name || 'Unknown Equipment',
            quantity: be.quantity || 1,
            price: Number(be.equipment?.price || 0),
            description: be.equipment?.description || be.equipment?.type || 'Equipment',
            type: be.equipment?.type || 'equipment',
        });
    }

    if (list.length === 0 && Array.isArray(booking?.addons?.equipment) && booking.addons.equipment.length > 0) {
        const equipmentMap = new Map(
            (allEquipment || []).map((e) => [e.name.toLowerCase().replace(/ /g, ''), e])
        );
        for (const item of booking.addons.equipment) {
            const slug = (item.id || '').toLowerCase().replace(/ /g, '');
            const matched = item.dbId ? allEquipment.find((e) => e.id === item.dbId) : equipmentMap.get(slug);
            const equipId = item.dbId || matched?.id;
            if (!equipId || equipId === INSURANCE_SERVICE_EQUIPMENT_ID || seenIds.has(equipId)) continue;
            seenIds.add(equipId);
            list.push({
                id: equipId,
                equipment_id: equipId,
                name: matched?.name || item.name || 'Equipment',
                quantity: item.quantity || 1,
                price: Number(matched?.price || item.price || 0),
                type: matched?.type || 'equipment',
            });
        }
    }

    if (bookingHadInsurance(booking?.addons)) {
        const applied = Number(booking.addons.insurancePriceApplied);
        list.push({
            id: 'insurance',
            name: 'Premium Insurance',
            quantity: 1,
            price: applied > 0 ? applied : insuranceFallbackPrice,
            type: 'insurance',
        });
    }

    if (booking?.addons?.drivewayProtection === 'accept') {
        const applied = Number(booking.addons.drivewayPriceApplied);
        list.push({
            id: 'driveway',
            name: 'Driveway Protection',
            quantity: 1,
            price: applied > 0 ? applied : 0,
            type: 'driveway',
        });
    }

    return list;
}

export const calculateDays = (dropOff, pickup) => {
    if (!dropOff || !pickup) return 1;
    const start = typeof dropOff === 'string' ? parseISO(dropOff) : dropOff;
    const end = typeof pickup === 'string' ? parseISO(pickup) : pickup;
    
    if (!isValid(start) || !isValid(end)) return 1;
    
    const days = differenceInDays(end, start) + 1;
    return Math.max(1, days);
};

export const calculateBookingCosts = async (
    service,
    days,
    addonsList,
    distanceMiles = 0,
    priceSnapshot = null,
    taxOptions = null
) => {
    if (!service) {
        return { serviceCost: 0, addonsCost: 0, subtotal: 0, tax: 0, total: 0 };
    }

    const miles = Number(service.id) === 1 || Number(service.id) === 3 || Number(service.id) === 4
        ? distanceMiles
        : 0;
    let taxRate = 7.45;
    let resolvedTaxOptions = taxOptions;

    if (!resolvedTaxOptions) {
        try {
            const rateData = await getTaxRate();
            taxRate = rateData?.tax_rate ?? taxRate;
            const { data: serviceRow } = await supabase
                .from('services')
                .select('is_taxable, delivery_fee_is_taxable, mileage_is_taxable')
                .eq('id', service.id)
                .maybeSingle();
            resolvedTaxOptions = {
                serviceTaxFlags: serviceRow || {},
                equipmentTaxFlags: {},
                insuranceIsTaxable: true,
                drivewayIsTaxable: true,
                drivewayPrice: 0,
            };
        } catch {
            resolvedTaxOptions = {
                serviceTaxFlags: {},
                equipmentTaxFlags: {},
                insuranceIsTaxable: true,
                drivewayIsTaxable: true,
                drivewayPrice: 0,
            };
        }
    }

    const { calculateRescheduleCosts } = await import('./rescheduleTaxCalculator');
    const costs = await calculateRescheduleCosts({
        service,
        days,
        addonsList,
        distanceMiles: miles,
        taxRate,
        taxOptions: resolvedTaxOptions,
        insurancePrice: 0,
        priceSnapshot,
    });

    const serviceCost = costs.baseRentalCost + costs.deliveryFee + costs.mileageCharge;

    return {
        serviceCost: round2(serviceCost),
        addonsCost: costs.addonsCost,
        mileageCharge: costs.mileageCharge,
        subtotal: costs.subtotal,
        tax: costs.tax,
        total: costs.total,
        taxRate: costs.taxRate,
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

export const calculateRescheduleFee = (
    originalTotal,
    originalApptTime,
    requestTime,
    lateReschedulePercentage = 5,
) => {
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
    const pct = Number(lateReschedulePercentage);
    const rate = Number.isFinite(pct) ? pct / 100 : 0.05;

    const feeAmount = feeApplies ? (baseTotal * rate) : 0;
    
    return {
        feeApplies,
        feeAmount: round2(feeAmount),
        newTotal: round2(baseTotal + feeAmount),
        timeDifferenceHours,
        feePercentage: Number.isFinite(pct) ? pct : 5,
    };
};

export const calculateAddonsDifference = async (originalAddons = [], newAddons = [], priceSnapshot = null) => {
    const originalMap = new Map();
    const newMap = new Map();
    
    for (const addon of originalAddons) {
        const key = addonMapKey(addon);
        const price = await resolveAddonUnitPrice(addon, priceSnapshot);
        originalMap.set(key, {
            ...addon,
            quantity: Number(addon.quantity || 1),
            price
        });
    }

    for (const addon of newAddons) {
        const key = addonMapKey(addon);
        const price = await resolveAddonUnitPrice(addon, priceSnapshot);
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
  for (const addon of selectedAddons.filter(a => (a.quantity ?? 0) > 0)) {
    const price = await resolveAddonUnitPrice(addon, priceSnapshot);

    addonsBreakdown.push({
      name: addon.name,
      price,
      quantity: addon.quantity,
      total: price * addon.quantity
    });
  }

  const addonsTotal = addonsBreakdown.reduce((sum, addon) => sum + addon.total, 0);
  const subtotal = baseRentalCost + deliveryFee + mileageCharge + addonsTotal + insurancePrice;
  let taxRatePercent = 7.45;
  try {
    const rateData = await getTaxRate();
    taxRatePercent = rateData?.tax_rate ?? taxRatePercent;
  } catch {
    // use default
  }
  const tax = subtotal * (taxRatePercent / 100);
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