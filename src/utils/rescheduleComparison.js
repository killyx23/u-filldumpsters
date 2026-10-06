import { isDrivewayAddon } from '@/utils/rescheduleAddons';
import { isInsuranceAddon, resolveNumericEquipmentId } from '@/utils/rescheduleCalculations';
import {
  additionalDayIncludesPrint,
  hasEquipmentPriceSnapshot,
  isRentalEquipmentItem,
  quoteRentalEquipmentLine,
  resolveEquipmentCharge,
  roundMoney,
} from '@/utils/rentalEquipmentPricing';

const emptyQuote = {
  quantity: 0,
  unitPrice: 0,
  total: 0,
  note: '',
  basePrice: 0,
  additionalDayPrice: 0,
  rentalDays: 1,
  extraDays: 0,
  extraDayCharge: 0,
  lineTotal: 0,
};

export function comparisonAddonKey(addon) {
  if (isInsuranceAddon(addon)) return 'insurance';
  if (isDrivewayAddon(addon)) return 'driveway';
  const id = resolveNumericEquipmentId(addon);
  if (id != null) return `eq-${id}`;
  return `name-${String(addon?.name || 'unknown').toLowerCase()}`;
}

/** Equipment in catalog order (type, then name), then insurance, then driveway. */
function comparisonSortTuple(addon) {
  if (isInsuranceAddon(addon)) return [2, '', 'premium insurance'];
  if (isDrivewayAddon(addon)) return [3, '', 'driveway protection'];
  return [
    1,
    String(addon?.type || 'zzz').toLowerCase(),
    String(addon?.name || '').toLowerCase(),
  ];
}

export function compareAddonsByCatalogOrder(a, b) {
  const left = comparisonSortTuple(a);
  const right = comparisonSortTuple(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

/**
 * Price one add-on for a stay.
 * Original rows can keep the stored snapshot. New rows recompute from the
 * catalog extra-day rate and the requested day count.
 */
export function quoteAddonForComparison(addon, rentalDays, { useSnapshot = false } = {}) {
  if (!addon) return { ...emptyQuote };

  if (isInsuranceAddon(addon) || isDrivewayAddon(addon)) {
    const unit = roundMoney(addon.price ?? addon.unitPrice ?? 0);
    const qty = Math.max(0, Number(addon.quantity || 1));
    const total = roundMoney(unit * qty);
    return {
      ...emptyQuote,
      quantity: qty,
      unitPrice: unit,
      total,
      basePrice: unit,
      lineTotal: total,
    };
  }

  if (useSnapshot && hasEquipmentPriceSnapshot(addon)) {
    const charge = resolveEquipmentCharge(addon);
    return {
      quantity: charge.quantity,
      unitPrice: charge.basePrice,
      total: charge.lineTotal,
      note: additionalDayIncludesPrint(charge),
      basePrice: charge.basePrice,
      additionalDayPrice: charge.additionalDayPrice,
      rentalDays: charge.rentalDays,
      extraDays: charge.extraDays,
      extraDayCharge: charge.extraDayCharge,
      lineTotal: charge.lineTotal,
    };
  }

  const rental = isRentalEquipmentItem(addon);
  const quote = quoteRentalEquipmentLine({
    basePrice: addon.basePrice ?? addon.price ?? addon.unitPrice ?? 0,
    additionalDayPrice: addon.additionalDayPrice ?? addon.additional_day_price ?? 0,
    quantity: addon.quantity || 0,
    rentalDays,
    isRental: rental,
  });
  return {
    quantity: quote.quantity,
    unitPrice: quote.basePrice,
    total: quote.lineTotal,
    note: additionalDayIncludesPrint(quote),
    basePrice: quote.basePrice,
    additionalDayPrice: quote.additionalDayPrice,
    rentalDays: quote.rentalDays,
    extraDays: quote.extraDays,
    extraDayCharge: quote.extraDayCharge,
    lineTotal: quote.lineTotal,
  };
}

export function alignComparisonAddons(originalList = [], newList = [], {
  originalDays = 1,
  newDays = 1,
} = {}) {
  const rows = new Map();

  const consider = (addon, side) => {
    const key = comparisonAddonKey(addon);
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        name: addon?.name || 'Add-on',
        sample: addon,
        originalAddon: null,
        nextAddon: null,
      });
    }
    const row = rows.get(key);
    row[side === 'original' ? 'originalAddon' : 'nextAddon'] = addon;
    if (addon?.name) row.name = addon.name;
    if (side === 'original') row.sample = addon;
  };

  for (const addon of originalList || []) consider(addon, 'original');
  for (const addon of newList || []) consider(addon, 'next');

  return Array.from(rows.values())
    .sort((a, b) => compareAddonsByCatalogOrder(a.sample, b.sample))
    .map((row) => ({
      key: row.key,
      name: row.name,
      original: row.originalAddon
        ? quoteAddonForComparison(row.originalAddon, originalDays, { useSnapshot: true })
        : { ...emptyQuote },
      next: row.nextAddon
        ? quoteAddonForComparison(row.nextAddon, newDays, { useSnapshot: false })
        : { ...emptyQuote },
    }));
}

/** Persist the quoted extra-day breakdown on the add-ons that get submitted. */
export function stampRescheduleAddons(addons = [], rentalDays) {
  return [...(addons || [])]
    .sort(compareAddonsByCatalogOrder)
    .map((addon) => {
      const quoted = quoteAddonForComparison(addon, rentalDays, { useSnapshot: false });
      return {
        ...addon,
        quantity: quoted.quantity || Number(addon.quantity || 1),
        price: quoted.basePrice,
        basePrice: quoted.basePrice,
        additionalDayPrice: quoted.additionalDayPrice,
        rentalDays: quoted.rentalDays,
        extraDays: quoted.extraDays,
        extraDayCharge: quoted.extraDayCharge,
        lineTotal: quoted.lineTotal,
      };
    });
}
