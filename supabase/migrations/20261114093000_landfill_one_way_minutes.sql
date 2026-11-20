-- Google drive time (one way) business ↔ landfill for driver labor.
-- Round trip labor minutes = landfill_one_way_minutes × 2 when haul is included.

ALTER TABLE public.operating_cost_rates
  ADD COLUMN IF NOT EXISTS landfill_one_way_minutes numeric(10, 2);
COMMENT ON COLUMN public.operating_cost_rates.landfill_one_way_minutes IS
  'One-way Google Maps drive minutes from business to landfill. Labor uses ×2 for round trip when a company landfill haul is included.';
-- Optional per-trip one-way landfill drive minutes override (else rates value).
ALTER TABLE public.booking_mileage_logs
  ADD COLUMN IF NOT EXISTS landfill_one_way_minutes_override numeric(10, 2);
COMMENT ON COLUMN public.booking_mileage_logs.landfill_one_way_minutes_override IS
  'One-way landfill drive minutes for this trip. Null uses operating_cost_rates.landfill_one_way_minutes.';
-- Seed a miles-based fallback (~45 mph) when minutes are still null.
UPDATE public.operating_cost_rates
SET landfill_one_way_minutes = ROUND((landfill_one_way_miles / 45.0) * 60.0, 1)
WHERE id = 1
  AND landfill_one_way_minutes IS NULL
  AND landfill_one_way_miles IS NOT NULL
  AND landfill_one_way_miles > 0;
