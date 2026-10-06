import { calculateBookingTaxBreakdown } from '@/utils/bookingTaxCalculator';
import {
  isInsuranceAddon,
  resolveNumericEquipmentId,
  resolveAddonUnitPrice,
} from '@/utils/rescheduleCalculations';
import { isDrivewayAddon } from '@/utils/rescheduleAddons';
import {
  hasEquipmentPriceSnapshot,
  isRentalEquipmentItem,
  quoteRentalEquipmentLine,
  rentalDayCount,
  roundMoney,
} from '@/utils/rentalEquipmentPricing';
import { quoteAddonForComparison } from '@/utils/rescheduleComparison';

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
        price: Number(addon.basePrice ?? addon.price ?? addon.unitPrice ?? 0),
        basePrice: addon.basePrice ?? addon.price ?? addon.unitPrice,
        additionalDayPrice: Number(addon.additionalDayPrice ?? addon.additional_day_price ?? 0),
        additional_day_price: Number(addon.additionalDayPrice ?? addon.additional_day_price ?? 0),
        rentalDays: addon.rentalDays,
        extraDays: addon.extraDays,
        extraDayCharge: addon.extraDayCharge,
        lineTotal: addon.lineTotal,
        type: addon.type,
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
  discounts = null,
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
  const quotedAddons = [];

  for (const addon of addonsList) {
    const listedPrice = addon?.price ?? addon?.basePrice ?? addon?.unitPrice;
    const price = listedPrice != null && listedPrice !== ''
      ? Number(listedPrice)
      : await resolveAddonUnitPrice(addon, priceSnapshot);
    const quoted = quoteAddonForComparison({
      ...addon,
      price,
      basePrice: addon?.basePrice ?? price,
      additionalDayPrice: addon?.additionalDayPrice ?? addon?.additional_day_price ?? 0,
    }, days, { useSnapshot: hasEquipmentPriceSnapshot(addon) });
    quotedAddons.push({
      ...addon,
      price: quoted.basePrice,
      basePrice: quoted.basePrice,
      additionalDayPrice: quoted.additionalDayPrice,
      rentalDays: quoted.rentalDays,
      extraDays: quoted.extraDays,
      extraDayCharge: quoted.extraDayCharge,
      lineTotal: quoted.lineTotal,
      quantity: quoted.quantity || Number(addon?.quantity || 1),
    });
    addonsCost += quoted.total;
    const equipId = resolveNumericEquipmentId(addon);
    if (equipId) equipmentPrices[equipId] = quoted.basePrice;
  }

  const addonsData = addonsListToAddonsData(quotedAddons, {
    deliveryFee,
    mileageCharge,
  });
  const insuranceQuoted = quotedAddons.find((addon) => isInsuranceAddon(addon));
  const drivewayQuoted = quotedAddons.find((addon) => isDrivewayAddon(addon));
  const insuranceAmount = insuranceQuoted
    ? Number(insuranceQuoted.lineTotal ?? insuranceQuoted.price ?? 0)
    : Number(insurancePrice || 0);
  const drivewayAmount = drivewayQuoted
    ? Number(drivewayQuoted.lineTotal ?? drivewayQuoted.price ?? 0)
    : Number(taxOptions.drivewayPrice ?? 0);
  if (discounts) {
    addonsData.loyaltyDiscountAmount = Number(discounts.loyaltyDiscountAmount || 0);
    addonsData.loyaltyPointsToRedeem = discounts.loyaltyPointsToRedeem || 0;
    addonsData.referralDiscountAmount = Number(discounts.referralDiscountAmount || 0);
    if (discounts.coupon) addonsData.coupon = discounts.coupon;
  }

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
    insurancePrice: insuranceAmount,
    insuranceIsTaxable: taxOptions.insuranceIsTaxable,
    drivewayPrice: drivewayAmount,
    drivewayIsTaxable: taxOptions.drivewayIsTaxable,
    serviceTaxFlags: taxOptions.serviceTaxFlags ?? {},
    equipmentTaxFlags: taxOptions.equipmentTaxFlags ?? {},
    rentalDays: days,
  });

  const gross = (breakdown.lineItems || []).reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const discountDetail = discountDetailFromAddons(addonsData, gross);

  return {
    baseRentalCost: round2(baseRentalCost),
    deliveryFee: round2(deliveryFee),
    mileageCharge: round2(mileageCharge),
    addonsCost: round2(addonsCost),
    discount: discountDetail.total,
    discounts: discountDetail,
    subtotal: breakdown.subtotalBeforeTax,
    tax: breakdown.tax,
    total: breakdown.total,
    taxRate: breakdown.taxRate,
    lineItems: breakdown.lineItems,
    taxableSubtotal: breakdown.taxableSubtotal,
    nonTaxableSubtotal: breakdown.nonTaxableSubtotal,
  };
}

function discountDetailFromAddons(addonsData, gross) {
  let coupon = 0;
  const couponData = addonsData?.coupon;
  if (couponData?.isValid) {
    if (couponData.discountType === 'fixed') {
      coupon = Number(couponData.discountValue || 0);
    } else if (couponData.discountType === 'percentage') {
      coupon = (Number(gross) * Number(couponData.discountValue || 0)) / 100;
    }
  }
  const loyalty = Number(addonsData?.loyaltyDiscountAmount || 0);
  const referral = Number(addonsData?.referralDiscountAmount || 0);
  return {
    loyalty: round2(loyalty),
    referral: round2(referral),
    coupon: round2(coupon),
    couponCode: couponData?.isValid ? couponData.code || null : null,
    total: round2(loyalty + referral + coupon),
  };
}

/**
 * Reprice a reschedule from the requested add-ons plus discounts already on the booking.
 * Equipment unit prices are kept so the saved snapshot matches the rows.
 */
export function quoteRescheduleBreakdown({
  plan,
  serviceId = null,
  existingAddons = {},
  newAddonsList = [],
  baseRentalCost = null,
  serviceCost = 0,
  mileageCharge = 0,
  deliveryFee = 0,
  taxRate = 0,
  insuranceIsTaxable = false,
  rentalDays = null,
  dropOff = null,
  pickup = null,
}) {
  const mapped = addonsListToAddonsData(newAddonsList, { deliveryFee, mileageCharge });
  const stayDays = rentalDays ?? ((dropOff || pickup) ? rentalDayCount(dropOff, pickup) : null);
  const planId = serviceId != null ? Number(serviceId) : plan?.id;
  const rentalPrice = baseRentalCost != null
    ? roundMoney(baseRentalCost)
    : roundMoney(Math.max(0, Number(serviceCost) - Number(deliveryFee || 0) - Number(mileageCharge || 0)));
  const equipmentPrices = {};
  mapped.equipment = mapped.equipment.map((item) => {
    const id = item.equipment_id ?? item.dbId ?? item.id;
    const base = Number(item.price || 0);
    if (id != null) equipmentPrices[id] = base;
    if (!isRentalEquipmentItem(item)) {
      const qty = Number(item.quantity || 1);
      return {
        ...item,
        price: base,
        basePrice: base,
        additionalDayPrice: 0,
        extraDays: 0,
        extraDayCharge: 0,
        lineTotal: round2(base * qty),
      };
    }
    const quote = quoteRentalEquipmentLine({
      basePrice: base,
      additionalDayPrice: item.additionalDayPrice,
      quantity: item.quantity,
      rentalDays: stayDays,
      dropOff,
      pickup,
      isRental: true,
    });
    return {
      ...item,
      type: 'rental',
      price: quote.basePrice,
      basePrice: quote.basePrice,
      additionalDayPrice: quote.additionalDayPrice,
      rentalDays: quote.rentalDays,
      extraDays: quote.extraDays,
      extraDayCharge: quote.extraDayCharge,
      lineTotal: quote.lineTotal,
    };
  });
  const addonsData = {
    equipment: mapped.equipment,
    insurance: mapped.insurance,
    drivewayProtection: mapped.drivewayProtection,
    insurancePriceApplied: mapped.insurance === 'accept' ? Number(mapped.insurancePriceApplied || 0) : 0,
    drivewayPriceApplied: mapped.drivewayProtection === 'accept' ? Number(mapped.drivewayPriceApplied || 0) : 0,
    deliveryFee: Number(deliveryFee || 0),
    mileageCharge: Number(mileageCharge || 0),
    loyaltyDiscountAmount: Number(existingAddons.loyaltyDiscountAmount || 0),
    loyaltyPointsToRedeem: existingAddons.loyaltyPointsToRedeem || 0,
    referralDiscountAmount: Number(existingAddons.referralDiscountAmount || 0),
    coupon: existingAddons.coupon || null,
  };
  const breakdown = calculateBookingTaxBreakdown({
    plan: { ...(plan || {}), price: rentalPrice, base_price: rentalPrice, id: planId },
    addonsData,
    equipmentPrices,
    taxRate,
    insurancePrice: addonsData.insurancePriceApplied,
    insuranceIsTaxable,
    drivewayPrice: addonsData.drivewayPriceApplied,
    drivewayIsTaxable: true,
    rentalDays: stayDays,
    dropOff,
    pickup,
  });
  return { mapped, breakdown, baseRentalCost: rentalPrice };
}
