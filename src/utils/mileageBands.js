export const DEFAULT_MILEAGE_BAND2_MILES = 30;
export const DEFAULT_MILEAGE_BAND3_MILES = 50;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function hasNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function milesOr(value, fallback) {
  if (!hasNumber(value) || Number(value) < 0) return fallback;
  return Number(value);
}

function rateOr(value, fallback) {
  if (!hasNumber(value) || Number(value) < 0) return fallback;
  return Number(value);
}

/** First rate is mileage_rate. Missing band rates use that same rate. */
export function resolveMileageBands(source, fallbackRate = 0.85) {
  const rate1 = rateOr(source?.mileage_rate, rateOr(fallbackRate, 0.85));
  return {
    rate1,
    band2Miles: milesOr(source?.mileage_band2_miles, DEFAULT_MILEAGE_BAND2_MILES),
    rate2: rateOr(source?.mileage_band2_rate, rate1),
    band3Miles: milesOr(source?.mileage_band3_miles, DEFAULT_MILEAGE_BAND3_MILES),
    rate3: rateOr(source?.mileage_band3_rate, rate1),
  };
}

/**
 * Charge measured miles in three bands.
 * Miles through `includedMiles` are free. A mark below the free miles does not
 * charge those miles again.
 */
export function tieredMileageCharge(measuredMiles, includedMiles, bands) {
  const miles = Math.max(0, Number(measuredMiles) || 0);
  const start = Math.max(0, Number(includedMiles) || 0);
  const resolved = bands?.rate1 != null ? bands : resolveMileageBands(bands);
  const band1End = Math.max(start, Number(resolved.band2Miles) || 0);
  const band2End = Math.max(band1End, Number(resolved.band3Miles) || 0);
  const milesBetween = (from, to) => Math.max(0, Math.min(miles, to) - from);
  const band1Miles = milesBetween(start, band1End);
  const band2Miles = milesBetween(band1End, band2End);
  const band3Miles = Math.max(0, miles - band2End);
  return {
    band1Miles,
    band2Miles,
    band3Miles,
    charge: round2(band1Miles * resolved.rate1 + band2Miles * resolved.rate2 + band3Miles * resolved.rate3),
  };
}

export function chargeMileageBands(measuredMiles, includedMiles, source) {
  return tieredMileageCharge(measuredMiles, includedMiles, resolveMileageBands(source)).charge;
}

export function mileageBandCacheKey(source) {
  const bands = resolveMileageBands(source);
  return `${bands.rate1}_${bands.band2Miles}_${bands.rate2}_${bands.band3Miles}_${bands.rate3}`;
}

function mileLabel(miles) {
  const amount = Number(Number(miles).toFixed(2));
  return `${amount} ${amount === 1 ? 'mile' : 'miles'}`;
}

function money(rate) {
  return Number(rate).toFixed(2);
}

/** Customer sentence for the three delivery mileage bands. */
export function mileageBandFeePhrase(source) {
  const bands = resolveMileageBands(source);
  return `$${money(bands.rate1)}/mile up to ${mileLabel(bands.band2Miles)}, then $${money(bands.rate2)}/mile up to ${mileLabel(bands.band3Miles)}, then $${money(bands.rate3)}/mile after that`;
}
