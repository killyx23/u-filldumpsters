import { differenceInDays, isValid, parseISO } from 'date-fns';

export function roundMoney(amount) {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

/** Inclusive rental days, matching calculateDays in rescheduleCalculations. */
export function rentalDayCount(dropOff, pickup) {
  if (!dropOff || !pickup) return 1;
  const start = typeof dropOff === 'string' ? parseISO(dropOff) : dropOff;
  const end = typeof pickup === 'string' ? parseISO(pickup) : pickup;
  if (!isValid(start) || !isValid(end)) return 1;
  return Math.max(1, differenceInDays(end, start) + 1);
}

export function isChargeableEquipmentId(id) {
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId > 0 && numericId !== 7;
}

export function equipmentNumericId(item) {
  const raw = item?.equipment_id ?? item?.dbId ?? item?.id;
  const numericId = Number(raw);
  return isChargeableEquipmentId(numericId) ? numericId : null;
}

export function isRentalEquipmentItem(item, typeHint = null) {
  const id = equipmentNumericId(item);
  if (id === 3) return false;
  const type = String(item?.type || typeHint || '').toLowerCase();
  if (type === 'purchase' || type === 'consumable' || type === 'service') return false;
  if (type === 'rental') return true;
  if (item?.additionalDayPrice != null || item?.additional_day_price != null) return true;
  return id === 1 || id === 2;
}

/**
 * First day is the base price. Each later day adds the extra-day rate.
 * line total = (base + extra-day rate × extra days) × quantity
 */
export function quoteRentalEquipmentLine({
  basePrice = 0,
  additionalDayPrice = 0,
  quantity = 1,
  dropOff = null,
  pickup = null,
  rentalDays = null,
  isRental = true,
} = {}) {
  const qty = Math.max(0, Number(quantity) || 0);
  const base = roundMoney(Math.max(0, Number(basePrice) || 0));
  const rate = isRental ? roundMoney(Math.max(0, Number(additionalDayPrice) || 0)) : 0;
  const days = rentalDays != null && Number(rentalDays) > 0
    ? Math.max(1, Math.round(Number(rentalDays)))
    : rentalDayCount(dropOff, pickup);
  const extraDays = isRental ? Math.max(0, days - 1) : 0;
  const perUnitExtra = roundMoney(rate * extraDays);
  const extraDayCharge = roundMoney(perUnitExtra * qty);
  const lineTotal = roundMoney((base + perUnitExtra) * qty);
  return {
    basePrice: base,
    additionalDayPrice: rate,
    rentalDays: isRental ? days : 1,
    extraDays,
    extraDayCharge,
    quantity: qty,
    lineTotal,
  };
}

function extraDayParts(quote) {
  if (!quote || !(Number(quote.extraDays) > 0) || !(Number(quote.additionalDayPrice) > 0)) return null;
  return {
    rate: Number(quote.additionalDayPrice).toFixed(2),
    extra: Number(quote.extraDayCharge).toFixed(2),
    days: Number(quote.extraDays),
  };
}

function quantitySuffix(quote) {
  const qty = Number(quote?.quantity || 1);
  return qty > 1 ? ` × ${qty}` : '';
}

export function additionalDayFinePrint(quote) {
  const parts = extraDayParts(quote);
  if (!parts) return '';
  return `Additional days: $${parts.rate} × ${parts.days}${quantitySuffix(quote)} = $${parts.extra}`;
}

export function additionalDayIncludesPrint(quote) {
  const parts = extraDayParts(quote);
  if (!parts) return '';
  const dayLabel = parts.days === 1 ? 'additional day' : 'additional days';
  return `Includes $${parts.rate} × ${parts.days} ${dayLabel}${quantitySuffix(quote)}`;
}

export function hasEquipmentPriceSnapshot(item) {
  if (!item || item.lineTotal == null || item.lineTotal === '') return false;
  return item.basePrice != null || item.additionalDayPrice != null;
}

/** Receipts prefer the stored breakdown. Older bookings stay at the flat price already charged. */
export function resolveEquipmentCharge(item, { liveBasePrice = 0 } = {}) {
  const qty = Math.max(0, Number(item?.quantity || 1));
  if (hasEquipmentPriceSnapshot(item)) {
    const base = roundMoney(item.basePrice ?? liveBasePrice);
    const rate = roundMoney(item.additionalDayPrice ?? 0);
    const extraDays = item.extraDays != null
      ? Math.max(0, Number(item.extraDays) || 0)
      : Math.max(0, (Number(item.rentalDays) || 1) - 1);
    const extraDayCharge = item.extraDayCharge != null
      ? roundMoney(item.extraDayCharge)
      : roundMoney(rate * extraDays * qty);
    return {
      basePrice: base,
      additionalDayPrice: rate,
      rentalDays: item.rentalDays != null ? Number(item.rentalDays) : extraDays + 1,
      extraDays,
      extraDayCharge,
      quantity: qty,
      lineTotal: roundMoney(item.lineTotal),
      snapshotted: true,
    };
  }

  const flat = roundMoney(item?.price ?? item?.unitPrice ?? liveBasePrice);
  return {
    basePrice: flat,
    additionalDayPrice: 0,
    rentalDays: 1,
    extraDays: 0,
    extraDayCharge: 0,
    quantity: qty,
    lineTotal: roundMoney(flat * qty),
    snapshotted: false,
  };
}

export function equipmentLineAmount(item, equipmentPrices = {}, {
  rentalDays = null,
  dropOff = null,
  pickup = null,
  additionalDayPrices = {},
  equipmentTypes = {},
} = {}) {
  if (hasEquipmentPriceSnapshot(item)) {
    return resolveEquipmentCharge(item).lineTotal;
  }

  const equipmentId = equipmentNumericId(item);
  const key = equipmentId ?? (item?.equipment_id || item?.dbId || item?.id);
  const qty = Number(item?.quantity || 1);
  const type = item?.type || equipmentTypes[key] || equipmentTypes[equipmentId];
  const rental = isRentalEquipmentItem(item, type);
  const base = Number(equipmentPrices[key] ?? equipmentPrices[equipmentId] ?? item?.price ?? item?.basePrice ?? 0);
  const rate = Number(
    item?.additionalDayPrice ??
    item?.additional_day_price ??
    additionalDayPrices[key] ??
    additionalDayPrices[equipmentId] ??
    0
  );

  return quoteRentalEquipmentLine({
    basePrice: base,
    additionalDayPrice: rate,
    quantity: qty,
    rentalDays,
    dropOff,
    pickup,
    isRental: rental,
  }).lineTotal;
}

export function quoteEquipmentLineForItem(item, equipmentPrices = {}, options = {}) {
  if (hasEquipmentPriceSnapshot(item)) {
    return resolveEquipmentCharge(item, { liveBasePrice: options.liveBasePrice });
  }
  const equipmentId = equipmentNumericId(item);
  const key = equipmentId ?? (item?.equipment_id || item?.dbId || item?.id);
  const type = item?.type || options.equipmentTypes?.[key];
  const rental = isRentalEquipmentItem(item, type);
  const base = Number(
    equipmentPrices[key] ??
    equipmentPrices[equipmentId] ??
    item?.price ??
    item?.basePrice ??
    0
  );
  const rate = Number(
    item?.additionalDayPrice ??
    options.additionalDayPrices?.[key] ??
    options.additionalDayPrices?.[equipmentId] ??
    0
  );
  return quoteRentalEquipmentLine({
    basePrice: base,
    additionalDayPrice: rate,
    quantity: item?.quantity || 1,
    rentalDays: options.rentalDays,
    dropOff: options.dropOff,
    pickup: options.pickup,
    isRental: rental,
  });
}

export function stampEquipmentSnapshots(equipment = [], {
  prices = {},
  additionalDayPrices = {},
  types = {},
  names = {},
  dropOff = null,
  pickup = null,
} = {}) {
  return (equipment || []).map((item) => {
    const id = equipmentNumericId(item) ?? item?.dbId ?? item?.equipment_id ?? item?.id;
    const type = item?.type || types[id];
    const rental = isRentalEquipmentItem({ ...item, type }, type);
    const base = Number(prices[id] ?? item?.price ?? item?.basePrice ?? 0);
    const rate = rental
      ? Number(additionalDayPrices[id] ?? item?.additionalDayPrice ?? item?.additional_day_price ?? 0)
      : 0;
    const quote = quoteRentalEquipmentLine({
      basePrice: base,
      additionalDayPrice: rate,
      quantity: item?.quantity || 1,
      dropOff,
      pickup,
      isRental: rental,
    });
    if (!rental) {
      return { ...item, price: base, type: type || item?.type };
    }
    return {
      ...item,
      type: 'rental',
      name: item?.name || names[id] || undefined,
      price: quote.basePrice,
      basePrice: quote.basePrice,
      additionalDayPrice: quote.additionalDayPrice,
      rentalDays: quote.rentalDays,
      extraDays: quote.extraDays,
      extraDayCharge: quote.extraDayCharge,
      lineTotal: quote.lineTotal,
    };
  });
}

/** Extra equipment days added when a return date moves later. Uses the rate stored on the booking. */
export function quoteEquipmentExtension(booking, addedDays, catalogRates = {}) {
  const days = Math.max(0, Number(addedDays) || 0);
  const items = Array.isArray(booking?.addons?.equipment) ? booking.addons.equipment : [];
  const lines = [];
  let subtotal = 0;

  for (const item of items) {
    if (!isRentalEquipmentItem(item)) continue;
    const id = equipmentNumericId(item);
    const stored = item?.additionalDayPrice ?? item?.additional_day_price;
    const rate = roundMoney(stored != null ? stored : (catalogRates[id] ?? 0));
    const qty = Number(item?.quantity || 1);
    const amount = roundMoney(rate * days * qty);
    if (!(amount > 0)) continue;
    subtotal = roundMoney(subtotal + amount);
    lines.push({
      id: item.id || id,
      equipmentId: id,
      name: item.name || item.label,
      quantity: qty,
      additionalDayPrice: rate,
      addedDays: days,
      amount,
    });
  }

  return { subtotal, lines };
}

export function applyEquipmentExtension(equipment = [], addedDays, catalogRates = {}) {
  const days = Math.max(0, Number(addedDays) || 0);
  return (equipment || []).map((item) => {
    if (!isRentalEquipmentItem(item) || days <= 0) return item;
    const id = equipmentNumericId(item);
    const stored = item?.additionalDayPrice ?? item?.additional_day_price;
    const rate = roundMoney(stored != null ? stored : (catalogRates[id] ?? 0));
    if (!(rate > 0)) return item;
    const qty = Number(item?.quantity || 1);
    const base = roundMoney(item?.basePrice ?? item?.price ?? 0);
    const prevExtra = item?.extraDays != null ? Math.max(0, Number(item.extraDays) || 0) : 0;
    const extraDays = prevExtra + days;
    const extraDayCharge = roundMoney(rate * extraDays * qty);
    const lineTotal = roundMoney(base * qty + extraDayCharge);
    return {
      ...item,
      type: 'rental',
      price: base,
      basePrice: base,
      additionalDayPrice: rate,
      extraDays,
      extraDayCharge,
      rentalDays: extraDays + 1,
      lineTotal,
    };
  });
}
