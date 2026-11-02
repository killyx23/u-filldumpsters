/** Editable truck-cost inputs. Derived rates are calculated from these. */
export const DEFAULT_OPERATING_COST_RATES = {
  fuel_price_per_gallon: 5,
  truck_mpg: 8,
  maintenance_per_mile: 0.22,
  driver_hourly_rate: 30,
  landfill_ticket: 45,
  landfill_one_way_miles: 27,
};

export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function roundQuantity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function normalizeOperatingCostRates(row) {
  const source = row || {};
  const mpg = Number(source.truck_mpg);
  return {
    fuel_price_per_gallon: numberOr(source.fuel_price_per_gallon, DEFAULT_OPERATING_COST_RATES.fuel_price_per_gallon),
    truck_mpg: Number.isFinite(mpg) && mpg > 0 ? mpg : DEFAULT_OPERATING_COST_RATES.truck_mpg,
    maintenance_per_mile: numberOr(source.maintenance_per_mile, DEFAULT_OPERATING_COST_RATES.maintenance_per_mile),
    driver_hourly_rate: numberOr(source.driver_hourly_rate, DEFAULT_OPERATING_COST_RATES.driver_hourly_rate),
    landfill_ticket: numberOr(source.landfill_ticket, DEFAULT_OPERATING_COST_RATES.landfill_ticket),
    landfill_one_way_miles: numberOr(source.landfill_one_way_miles, DEFAULT_OPERATING_COST_RATES.landfill_one_way_miles),
  };
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Rates that must stay calculated so the line items cannot drift apart. */
export function derivedOperatingRates(rates) {
  const normalized = normalizeOperatingCostRates(rates);
  const fuelPerMile = normalized.fuel_price_per_gallon / normalized.truck_mpg;
  const laborPerMinute = normalized.driver_hourly_rate / 60;
  return {
    ...normalized,
    fuelPerMile,
    truckPerMile: fuelPerMile + normalized.maintenance_per_mile,
    laborPerMinute,
    landfillRoundTripMiles: roundQuantity(normalized.landfill_one_way_miles * 2),
  };
}

export function oneWayDriveMinutes(log) {
  const fromBooking = Number(log?.bookings?.addons?.distanceInfo?.duration);
  if (Number.isFinite(fromBooking) && fromBooking > 0) return fromBooking;
  const fromCustomer = Number(log?.customers?.travel_time_minutes);
  if (Number.isFinite(fromCustomer) && fromCustomer > 0) return fromCustomer;
  return 0;
}

/** Customer comes to the yard. Company delivery trips keep driver labor. */
export function customerPickupBooking(log) {
  if (log?.trip_kind === 'delivery_pickup') return false;
  const addons = log?.bookings?.addons || {};
  if (addons.deliveryService || addons.isDelivery) return false;
  return true;
}

export function customerGpsMiles(log) {
  return roundQuantity(log?.customer_gps_miles);
}

/** Trailer miles plus the recorded round trip. GPS miles are the trailer miles. */
export function companyTrailerMiles(log) {
  return roundQuantity(numberOr(log?.round_trip_miles, 0) + numberOr(log?.customer_gps_miles, 0));
}

export function bookingTrailerName(log) {
  const items = log?.bookings?.assigned_inventory_items;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  return list
    .map((item) => {
      if (typeof item === 'string') return item;
      return item?.name || item?.label || item?.equipment_name || '';
    })
    .filter(Boolean)
    .join(', ');
}

/** Company landfill haul. Delivery trips only. Customer pickup never includes it. */
export function landfillHaulIncluded(log) {
  if (customerPickupBooking(log)) return false;
  if (typeof log?.landfill_haul_override === 'boolean') return log.landfill_haul_override;
  return log?.trip_kind === 'delivery_pickup';
}

/**
 * Dump trailer the customer picks up and returns. The company does not deliver,
 * so driver labor and the landfill haul are the customer's, not an operating cost.
 */
export function isDumpTrailerCustomerPickup(log) {
  if (log?.trip_kind === 'delivery_pickup') return false;
  const addons = log?.bookings?.addons || {};
  if (addons.isDelivery || addons.deliveryService) return false;
  const plan = log?.bookings?.plan || {};
  const serviceId = Number(log?.service_id ?? plan.service_id ?? plan.id);
  const name = `${log?.service_name || ''} ${plan.name || ''}`.toLowerCase();
  const dumpTrailer = serviceId === 2 || name.includes('dump trailer');
  if (!dumpTrailer) return false;
  return true;
}

/** Logged round-trip miles drive fuel and maintenance for every trip kind. */
export function defaultTruckMiles(log, rates) {
  const roundTrip = numberOr(log?.round_trip_miles, 0);
  const landfillMiles = landfillHaulIncluded(log)
    ? numberOr(rates?.landfill_one_way_miles, 0) * 2
    : 0;
  return roundQuantity(roundTrip + landfillMiles);
}

export function defaultDriverMinutes(log) {
  if (customerPickupBooking(log)) return 0;
  const oneWay = oneWayDriveMinutes(log);
  if (!(oneWay > 0)) return 0;
  return roundQuantity(oneWay * 2);
}

export function effectiveTruckMiles(log, rates) {
  if (log?.truck_miles_override != null && log.truck_miles_override !== '') {
    return roundQuantity(log.truck_miles_override);
  }
  return defaultTruckMiles(log, rates);
}

export function effectiveDriverMinutes(log) {
  if (customerPickupBooking(log)) return 0;
  if (log?.driver_minutes_override != null && log.driver_minutes_override !== '') {
    return roundQuantity(log.driver_minutes_override);
  }
  return defaultDriverMinutes(log);
}

/**
 * Exact operating cost for one booking.
 * Line items are rounded to cents, and the total is the sum of those lines.
 */
export function bookingOperatingCost(log, rates) {
  const derived = derivedOperatingRates(rates);
  const customerPickup = isDumpTrailerCustomerPickup(log);
  const customerGpsMiles = roundQuantity(log?.customer_gps_miles);
  const truckMiles = effectiveTruckMiles(log, derived);
  const driverMinutes = effectiveDriverMinutes(log);
  const includeLandfill = landfillHaulIncluded(log);
  const fuel = customerPickup ? 0 : roundMoney(truckMiles * derived.fuelPerMile);
  const maintenance = roundMoney(truckMiles * derived.maintenance_per_mile);
  const labor = roundMoney(driverMinutes * derived.laborPerMinute);
  const landfillTicket = includeLandfill ? roundMoney(derived.landfill_ticket) : 0;
  const customerGpsCost = customerPickup
    ? roundMoney(customerGpsMiles * derived.maintenance_per_mile)
    : 0;
  const trailerOperationalCost = customerPickup
    ? roundMoney(maintenance + customerGpsCost)
    : 0;
  const truckOperationalCost = customerPickup
    ? 0
    : roundMoney(fuel + maintenance + labor + landfillTicket);
  const total = roundMoney(truckOperationalCost + trailerOperationalCost);
  return {
    customerPickup,
    truckOperationalCost,
    trailerOperationalCost,
    customerGpsMiles,
    customerGpsCost,
    companyTrailerMiles: companyTrailerMiles(log),
    trailerName: bookingTrailerName(log),
    truckMiles,
    driverMinutes,
    includeLandfill,
    landfillMiles: includeLandfill ? derived.landfillRoundTripMiles : 0,
    fuelPerMile: derived.fuelPerMile,
    truckPerMile: derived.truckPerMile,
    laborPerMinute: derived.laborPerMinute,
    fuel,
    maintenance,
    labor,
    landfillTicket,
    total,
    truckMilesOverridden: log?.truck_miles_override != null && log.truck_miles_override !== '',
    driverMinutesOverridden: log?.driver_minutes_override != null && log.driver_minutes_override !== '',
    calculatedTruckMiles: defaultTruckMiles(
      { ...log, truck_miles_override: null },
      derived,
    ),
    calculatedDriverMinutes: defaultDriverMinutes({ ...log, driver_minutes_override: null }),
  };
}

export const EMPTY_OPERATING_COST_TOTALS = {
  tripCount: 0,
  miles: 0,
  fuel: 0,
  maintenance: 0,
  labor: 0,
  landfillTicket: 0,
  customerGpsCost: 0,
  trailerMiles: 0,
  truckOperationalCost: 0,
  trailerOperationalCost: 0,
  total: 0,
};

/** Sum per-booking operating costs, including extra GPS miles on customer pickups. */
export function sumOperatingCosts(logs, rates) {
  const totals = { ...EMPTY_OPERATING_COST_TOTALS };
  for (const log of logs || []) {
    const cost = bookingOperatingCost(log, rates);
    totals.tripCount += 1;
    totals.miles += cost.truckMiles;
    totals.fuel += cost.fuel;
    totals.maintenance += cost.maintenance;
    totals.labor += cost.labor;
    totals.landfillTicket += cost.landfillTicket;
    totals.customerGpsCost += cost.customerGpsCost;
    totals.trailerMiles += cost.companyTrailerMiles;
    totals.truckOperationalCost += cost.truckOperationalCost;
    totals.trailerOperationalCost += cost.trailerOperationalCost;
  }
  totals.miles = roundQuantity(totals.miles);
  totals.fuel = roundMoney(totals.fuel);
  totals.maintenance = roundMoney(totals.maintenance);
  totals.labor = roundMoney(totals.labor);
  totals.landfillTicket = roundMoney(totals.landfillTicket);
  totals.customerGpsCost = roundMoney(totals.customerGpsCost);
  totals.trailerMiles = roundQuantity(totals.trailerMiles);
  totals.truckOperationalCost = roundMoney(totals.truckOperationalCost);
  totals.trailerOperationalCost = roundMoney(totals.trailerOperationalCost);
  totals.total = roundMoney(totals.truckOperationalCost + totals.trailerOperationalCost);
  return totals;
}

export const OPERATING_EXPENSE_CATEGORIES = [
  { key: 'fuel', label: 'Fuel', unit: 'miles' },
  { key: 'maintenance', label: 'Maintenance', unit: 'miles' },
  { key: 'labor', label: 'Delivery labor', unit: 'minutes' },
  { key: 'trailerOperational', label: 'Trailer operational costs', unit: 'miles' },
];

function tripExpenseDate(log) {
  if (!log?.recorded_at) return null;
  const date = new Date(log.recorded_at);
  if (Number.isNaN(date.getTime())) return null;
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const day = String(date.getDate()).padStart(2, '0');
  return { date: `${month}-${day}`, month };
}

function emptyExpenseCategory(label) {
  return { label, total: 0, thisMonth: 0, monthlyAverage: 0, count: 0, lines: [] };
}

function monthsCovered(monthKeys) {
  const valid = monthKeys.filter((key) => /^\d{4}-\d{2}$/.test(key)).sort();
  if (!valid.length) return 0;
  const [startYear, startMonth] = valid[0].split('-').map(Number);
  const [endYear, endMonth] = valid[valid.length - 1].split('-').map(Number);
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

/**
 * One dated record per trip for fuel, maintenance, and delivery labor.
 * Zero amounts are omitted. Landfill is not included.
 */
export function operatingExpenseRecords(logs, rates) {
  const lines = [];
  for (const log of logs || []) {
    const cost = bookingOperatingCost(log, rates);
    const dated = tripExpenseDate(log);
    const shared = {
      logId: log?.id,
      bookingId: log?.booking_id ?? '',
      date: dated?.date || '',
      month: dated?.month || 'Undated',
    };
    const candidates = cost.customerPickup
      ? [
          {
            key: 'trailerOperational',
            category: 'Trailer operational costs',
            amount: cost.trailerOperationalCost,
            quantity: cost.companyTrailerMiles,
            unit: 'miles',
          },
        ]
      : [
          { key: 'fuel', category: 'Fuel', amount: cost.fuel, quantity: cost.truckMiles, unit: 'miles' },
          { key: 'maintenance', category: 'Maintenance', amount: cost.maintenance, quantity: cost.truckMiles, unit: 'miles' },
          { key: 'labor', category: 'Delivery labor', amount: cost.labor, quantity: cost.driverMinutes, unit: 'minutes' },
        ];
    for (const line of candidates) {
      if (!(line.amount > 0)) continue;
      lines.push({
        id: `${log?.id ?? 'log'}-${line.key}`,
        ...shared,
        category: line.category,
        categoryKey: line.key,
        quantity: line.quantity,
        unit: line.unit,
        amount: line.amount,
      });
    }
  }
  lines.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.bookingId).localeCompare(String(a.bookingId)));
  return lines;
}

/** Category totals, this month, monthly average, and a month-by-month table. */
export function summarizeOperatingExpenses(logs, rates, now = new Date()) {
  const lines = operatingExpenseRecords(logs, rates);
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const categories = {
    fuel: emptyExpenseCategory('Fuel'),
    maintenance: emptyExpenseCategory('Maintenance'),
    labor: emptyExpenseCategory('Delivery labor'),
    trailerOperational: emptyExpenseCategory('Trailer operational costs'),
  };
  const months = new Map();

  for (const line of lines) {
    const category = categories[line.categoryKey];
    category.total = roundMoney(category.total + line.amount);
    category.count += 1;
    category.lines.push(line);
    if (line.month === currentMonth) {
      category.thisMonth = roundMoney(category.thisMonth + line.amount);
    }
    if (!months.has(line.month)) {
      months.set(line.month, {
        month: line.month,
        fuel: 0,
        maintenance: 0,
        labor: 0,
        trailerOperational: 0,
        truckOperational: 0,
        total: 0,
      });
    }
    const row = months.get(line.month);
    row[line.categoryKey] = roundMoney((row[line.categoryKey] || 0) + line.amount);
  }

  const operationalByMonth = new Map();
  for (const log of logs || []) {
    const cost = bookingOperatingCost(log, rates);
    const month = tripExpenseDate(log)?.month || 'Undated';
    const prev = operationalByMonth.get(month) || { truckOperational: 0, trailerOperational: 0 };
    prev.truckOperational = roundMoney(prev.truckOperational + cost.truckOperationalCost);
    prev.trailerOperational = roundMoney(prev.trailerOperational + cost.trailerOperationalCost);
    operationalByMonth.set(month, prev);
  }
  for (const [month, amounts] of operationalByMonth) {
    if (!months.has(month)) {
      months.set(month, {
        month,
        fuel: 0,
        maintenance: 0,
        labor: 0,
        trailerOperational: 0,
        truckOperational: 0,
        total: 0,
      });
    }
    const row = months.get(month);
    row.truckOperational = amounts.truckOperational;
    row.trailerOperational = amounts.trailerOperational;
    row.total = roundMoney(row.truckOperational + row.trailerOperational);
  }

  const byMonth = Array.from(months.values()).sort((a, b) => b.month.localeCompare(a.month));
  const span = monthsCovered(byMonth.map((row) => row.month));
  for (const category of Object.values(categories)) {
    category.monthlyAverage = span > 0 ? roundMoney(category.total / span) : 0;
  }

  return { lines, categories, byMonth, monthSpan: span };
}
