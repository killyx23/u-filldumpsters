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
import { trailerDeliveryChargeableMiles } from '@/services/DistanceCalculationService';
import { resolveIncludedDeliveryMiles } from '@/utils/chargesAndFeesConfig';
import { chargeMileageBands } from '@/utils/mileageBands';
import { catalogBaseRental } from '@/utils/phoneOrderQuote';
import { discountsFromTaxBreakdown, stampCouponDiscountAmounts } from '@/utils/rescheduleCoupon';

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

/** Reschedule day counts are inclusive. Delivery-window services bill the span from one morning to the next as one day. */
export function countedServiceDays(service, inclusiveDays) {
  const days = Math.max(1, Number(inclusiveDays) || 1);
  const id = Number(service?.id);
  if (id === 1 || id === 3 || id === 4) return days <= 1 ? 1 : days - 1;
  return days;
}

/** Daily catalog rate — never a multi-day total. */
function catalogDailyRate(service) {
  const daily = Number(service?.base_price);
  if (Number.isFinite(daily) && daily > 0) return daily;
  const fallback = Number(service?.price);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

export function calculateBaseRentalCost(service, days) {
  if (!service) return 0;
  const id = Number(service.id);
  const counted = countedServiceDays(service, days);
  return catalogBaseRental({ ...service, id, base_price: catalogDailyRate(service) }, counted);
}

/**
 * Reschedule pricing with DB tax rate and per-line tax flags (matches booking flow).
 */
export async function calculateRescheduleCosts({
  service,
  days,
  addonsList = [],
  distanceMiles = 0,
  route = null,
  presetMileageCharge = null,
  taxRate = 0,
  taxOptions = {},
  insurancePrice = 0,
  priceSnapshot = null,
  discounts = null,
  /** Explicit coupon from reschedule UI; overrides discounts.coupon when provided (including null). */
  coupon = undefined,
  includedMiles = null,
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
      discounts: { loyalty: 0, referral: 0, coupon: 0, couponCode: null, total: 0 },
      coupon: null,
      couponDiscountAmount: 0,
    };
  }

  const countedDays = countedServiceDays(service, days);
  const dailyRate = catalogDailyRate(service);
  const baseRentalCost = calculateBaseRentalCost(service, days);
  const isDelivery = isDeliveryServiceId(service.id);
  const deliveryFee = isDelivery ? Number(service.delivery_fee || 0) : 0;
  const included = resolveIncludedDeliveryMiles(includedMiles);

  let mileageCharge = 0;
  if (presetMileageCharge != null && Number.isFinite(Number(presetMileageCharge))) {
    mileageCharge = Number(presetMileageCharge);
  } else if (isDelivery && (distanceMiles > 0 || route)) {
    if (Number(service.id) === 4 && route) {
      const priced = trailerDeliveryChargeableMiles(route, included);
      mileageCharge = chargeMileageBands(priced.businessToCustomer, included, service);
    } else if (Number(service.id) === 4) {
      mileageCharge = chargeMileageBands(Number(distanceMiles), included, service);
    } else {
      mileageCharge = chargeMileageBands(Number(distanceMiles) * 2, 0, service);
    }
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
  if (coupon !== undefined) {
    addonsData.coupon = coupon?.isValid ? coupon : null;
  }

  // Keep daily catalog rates on the plan. Passing a multi-day total as base_price
  // made resolveBaseRentalAmount multiply by days again (e.g. $200 → $400).
  const breakdown = calculateBookingTaxBreakdown({
    plan: {
      ...service,
      base_price: dailyRate,
      price: dailyRate,
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
    rentalDays: countedDays,
  });

  const activeCoupon = addonsData.coupon?.isValid ? addonsData.coupon : null;
  const discountDetail = discountsFromTaxBreakdown(breakdown, activeCoupon);
  const stamped = stampCouponDiscountAmounts(activeCoupon, breakdown.couponDiscount);
  const baseFromLines = (breakdown.lineItems || []).find((line) => line.key === 'base_rental')?.amount;

  return {
    baseRentalCost: round2(baseFromLines ?? baseRentalCost),
    deliveryFee: round2(deliveryFee),
    mileageCharge: round2(mileageCharge),
    addonsCost: round2(addonsCost),
    discount: discountDetail.total,
    discounts: discountDetail,
    coupon: stamped.coupon,
    couponDiscountAmount: stamped.couponDiscountAmount,
    subtotal: breakdown.subtotalBeforeTax,
    tax: breakdown.tax,
    total: breakdown.total,
    taxRate: breakdown.taxRate,
    lineItems: breakdown.lineItems,
    taxableSubtotal: breakdown.taxableSubtotal,
    nonTaxableSubtotal: breakdown.nonTaxableSubtotal,
    countedDays,
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
  /** When provided (including null), overrides existingAddons.coupon. */
  coupon = undefined,
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
  const resolvedCoupon = coupon !== undefined
    ? (coupon?.isValid ? coupon : null)
    : (existingAddons.coupon || null);
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
    coupon: resolvedCoupon,
  };
  const dailyRate = catalogDailyRate(plan);
  // Quoted multi-day total goes on plan.price only. Keep base_price as the daily
  // catalog rate so resolveBaseRentalAmount does not multiply days twice.
  const breakdown = calculateBookingTaxBreakdown({
    plan: {
      ...(plan || {}),
      id: planId,
      base_price: dailyRate,
      price: rentalPrice,
    },
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
  const discounts = discountsFromTaxBreakdown(breakdown, resolvedCoupon);
  const stamped = stampCouponDiscountAmounts(resolvedCoupon, breakdown.couponDiscount);
  return {
    mapped,
    breakdown,
    baseRentalCost: rentalPrice,
    discounts,
    coupon: stamped.coupon,
    couponDiscountAmount: stamped.couponDiscountAmount,
  };
}
