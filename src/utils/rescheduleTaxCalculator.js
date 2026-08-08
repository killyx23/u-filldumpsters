import { calculateBookingTaxBreakdown } from '@/utils/bookingTaxCalculator';
import {
  isInsuranceAddon,
  resolveNumericEquipmentId,
  resolveAddonUnitPrice,
} from '@/utils/rescheduleCalculations';
import { isDrivewayAddon } from '@/utils/rescheduleAddons';

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

export function isDeliveryServiceId(serviceId) {
  return [1, 3, 4].includes(Number(serviceId));
}

export function addonsListToAddonsData(addonsList = [], { deliveryFee = 0, mileageCharge = 0 } = {}) {
  const addonsData = {
    equipment: [],
    insurance: 'decline',
    drivewayProtection: 'decline',
    deliveryFee,
    mileageCharge,
  };

  for (const addon of addonsList || []) {
    if (isInsuranceAddon(addon)) {
      addonsData.insurance = 'accept';
      addonsData.insurancePriceApplied = Number(addon.price || 0);
      continue;
    }

    if (isDrivewayAddon(addon)) {
      addonsData.drivewayProtection = 'accept';
      addonsData.drivewayPriceApplied = Number(addon.price || 0);
      continue;
    }

    const equipId = resolveNumericEquipmentId(addon);
    if (equipId) {
      addonsData.equipment.push({
        id: equipId,
        dbId: equipId,
        equipment_id: equipId,
        name: addon.name,
        quantity: Number(addon.quantity || 1),
      });
    }
  }

  return addonsData;
}

export function calculateBaseRentalCost(service, days) {
  if (!service) return 0;
  const basePrice = Number(service.base_price) || 0;
  const id = Number(service.id);

  if (id === 1) {
    return days === 7 ? 500 : basePrice + Math.max(0, days - 1) * 50;
  }
  if (id === 2 || id === 4 || id === 5 || id === 8) {
    return basePrice * days;
  }
  if (id === 3) {
    return basePrice;
  }
  return basePrice * days;
}

/**
 * Reschedule pricing with DB tax rate and per-line tax flags (matches booking flow).
 */
export async function calculateRescheduleCosts({
  service,
  days,
  addonsList = [],
  distanceMiles = 0,
  taxRate = 0,
  taxOptions = {},
  insurancePrice = 0,
  priceSnapshot = null,
}) {
  if (!service) {
    return {
      baseRentalCost: 0,
      deliveryFee: 0,
      mileageCharge: 0,
      addonsCost: 0,
      subtotal: 0,
      tax: 0,
      total: 0,
      taxRate: 0,
      lineItems: [],
    };
  }

  const baseRentalCost = calculateBaseRentalCost(service, days);
  const isDelivery = isDeliveryServiceId(service.id);
  const deliveryFee = isDelivery ? Number(service.delivery_fee || 0) : 0;
  const mileageRate = Number(service.mileage_rate || 0.85);

  let mileageCharge = 0;
  if (isDelivery && distanceMiles > 0) {
    mileageCharge = distanceMiles * 2 * mileageRate;
  }

  const equipmentPrices = {};
  let addonsCost = 0;

  for (const addon of addonsList) {
    const price = await resolveAddonUnitPrice(addon, priceSnapshot);
    const qty = Number(addon?.quantity || 1);
    addonsCost += price * qty;

    const equipId = resolveNumericEquipmentId(addon);
    if (equipId) {
      equipmentPrices[equipId] = price;
    }
  }

  const addonsData = addonsListToAddonsData(addonsList, {
    deliveryFee,
    mileageCharge,
  });

  const breakdown = calculateBookingTaxBreakdown({
    plan: {
      ...service,
      price: baseRentalCost,
      base_price: baseRentalCost,
    },
    addonsData,
    equipmentPrices,
    taxRate,
    deliveryService: false,
    insurancePrice,
    insuranceIsTaxable: taxOptions.insuranceIsTaxable,
    drivewayPrice: taxOptions.drivewayPrice ?? 0,
    drivewayIsTaxable: taxOptions.drivewayIsTaxable,
    serviceTaxFlags: taxOptions.serviceTaxFlags ?? {},
    equipmentTaxFlags: taxOptions.equipmentTaxFlags ?? {},
  });

  return {
    baseRentalCost: round2(baseRentalCost),
    deliveryFee: round2(deliveryFee),
    mileageCharge: round2(mileageCharge),
    addonsCost: round2(addonsCost),
    subtotal: breakdown.subtotalBeforeTax,
    tax: breakdown.tax,
    total: breakdown.total,
    taxRate: breakdown.taxRate,
    lineItems: breakdown.lineItems,
    taxableSubtotal: breakdown.taxableSubtotal,
    nonTaxableSubtotal: breakdown.nonTaxableSubtotal,
  };
}
