export const DEFAULT_FEES = {
  extension_fee: 75,
  dry_run_percentage: 50,
  dumpster_allowed_tons: 2.5,
  dumpster_overweight_rate: 100,
  dump_loader_max_tons: 5,
  base_dump_fee: 150,
  dump_tonnage_rate: 45,
  dump_rate_tons: 1,
  included_delivery_miles: 30,
  special_item_fee_min: 20,
  special_item_fee_max: 50,
  cleaning_fee: 20,
  advance_cancel_percentage: 10,
  late_cancel_percentage: 50,
  advance_reschedule_percentage: 0,
  late_reschedule_percentage: 5,
  small_equipment_admin_rate: 15,
  driveway_protection_plan_cost: 15,
  hardware_protection_plan_cost: 15,
  hardware_protection_plan_cap: 500,
  hpp_missing_remote_fee: 350,
  hpp_missing_winch_controller_fee: 150,
  hpp_missing_lighting_fixture_fee: 75,
  hpp_missing_hydraulic_hose_fee: 100,
  hpp_missing_tarp_assembly_fee: 250,
  overload_fee: 150,
  environmental_cleanup_fee: 250,
};

export const HPP_ENROLLMENT_FEE_KEY = 'hardware_protection_plan_cost';

/** Enrollment fee follows the live Hardware Protection Plan price when admin has set one. */
export const createHppFeeLookup = (fees = {}, planPrice = null) => {
  const base = createFeeLookup(fees);
  return (key) => {
    if (key === HPP_ENROLLMENT_FEE_KEY && planPrice != null && planPrice !== '') {
      const amount = Number(planPrice);
      if (!Number.isNaN(amount)) return amount;
    }
    return base(key);
  };
};

export const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;
export const formatPercent = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, '')}`;
export const formatTons = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '');

export const DUMP_RATE_TONS_KEY = 'dump_rate_tons';
export const INCLUDED_DELIVERY_MILES_KEY = 'included_delivery_miles';
export const DEFAULT_INCLUDED_DELIVERY_MILES = 30;

/** Missing or invalid values stay at 30 included miles. Zero stays zero. */
export function resolveIncludedDeliveryMiles(value) {
  if (value == null || value === '') return DEFAULT_INCLUDED_DELIVERY_MILES;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return DEFAULT_INCLUDED_DELIVERY_MILES;
  return amount;
}

/** "30", "20.5", or "1". */
export function formatIncludedMileCount(miles) {
  const amount = resolveIncludedDeliveryMiles(miles);
  return String(Number(amount.toFixed(2)));
}

/** "1 mile" or "20 miles". */
export function includedMilesPhrase(miles) {
  const count = formatIncludedMileCount(miles);
  return `${count} ${count === '1' ? 'mile' : 'miles'}`;
}

export function includedDeliveryMileageExplanation(miles) {
  return `The first ${includedMilesPhrase(miles)} plus the mileage to the landfill are included in the basic delivery fee, and every additional mile beyond that is charged at the mileage rate.`;
}

/** "1" or "0.5". Missing or non-numeric values fall back to 1 ton. Zero stays zero. */
export function formatLandfillTonCount(tons) {
  if (tons == null || tons === '') return '1';
  const amount = Number(tons);
  if (!Number.isFinite(amount)) return '1';
  return String(Number(amount.toFixed(2)));
}

/** "for 1 ton", "for 0.5 tons", "for 0 tons". */
export function landfillTonClause(tons) {
  const count = formatLandfillTonCount(tons);
  return `for ${count} ${count === '1' ? 'ton' : 'tons'}`;
}

/** "$45.00 for 1 ton". */
export function landfillRatePhrase(rate, tons) {
  return `${formatMoney(rate)} ${landfillTonClause(tons)}`;
}

export const UNAVAILABLE_FEE_TEXT = 'Unavailable. Contact customer service.';

export function readAdminFee(fees, key) {
  if (!fees || !Object.prototype.hasOwnProperty.call(fees, key)) return null;
  const amount = Number(fees[key]);
  return Number.isFinite(amount) ? amount : null;
}

function formatAdminValue(value, formatter) {
  if (value == null || value === '') return UNAVAILABLE_FEE_TEXT;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return UNAVAILABLE_FEE_TEXT;
  return formatter(amount);
}

export const formatAdminMoney = (value) => formatAdminValue(value, formatMoney);
export const formatAdminPercent = (value) => formatAdminValue(value, formatPercent);
export const formatAdminTons = (value) => formatAdminValue(value, formatTons);

export const mapFeeRowsToConfig = (rows = []) =>
  (rows || []).reduce((acc, row) => {
    if (!row?.fee_key) return acc;
    return { ...acc, [row.fee_key]: Number(row.fee_value) };
  }, {});

export const createFeeLookup = (fees = {}) => (key) => fees[key] ?? DEFAULT_FEES[key];
