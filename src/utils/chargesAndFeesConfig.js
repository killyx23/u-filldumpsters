export const DEFAULT_FEES = {
  extension_fee: 75,
  dry_run_percentage: 50,
  dumpster_allowed_tons: 2.5,
  dumpster_overweight_rate: 100,
  dump_loader_max_tons: 5,
  base_dump_fee: 150,
  dump_tonnage_rate: 45,
  special_item_fee_min: 20,
  special_item_fee_max: 50,
  cleaning_fee: 20,
  advance_cancel_percentage: 10,
  late_cancel_percentage: 50,
  small_equipment_admin_rate: 15,
  driveway_protection_plan_cost: 15,
  hardware_protection_plan_cost: 15,
  hardware_protection_plan_cap: 500,
};

export const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;
export const formatPercent = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, '')}`;
export const formatTons = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, '');

export const mapFeeRowsToConfig = (rows = []) =>
  (rows || []).reduce((acc, row) => {
    if (!row?.fee_key) return acc;
    return { ...acc, [row.fee_key]: Number(row.fee_value) };
  }, {});

export const createFeeLookup = (fees = {}) => (key) => fees[key] ?? DEFAULT_FEES[key];
