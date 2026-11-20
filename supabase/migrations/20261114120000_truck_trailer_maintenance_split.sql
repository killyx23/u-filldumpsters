-- Split combined maintenance ($0.22/mi) into truck ($0.15) and trailer ($0.07).
-- maintenance_per_mile stays as the sum for backward-compatible readers.

ALTER TABLE public.operating_cost_rates
  ADD COLUMN IF NOT EXISTS truck_maintenance_per_mile numeric(10, 4),
  ADD COLUMN IF NOT EXISTS trailer_maintenance_per_mile numeric(10, 4);
COMMENT ON COLUMN public.operating_cost_rates.truck_maintenance_per_mile IS
  'Per-mile maintenance for the company truck (e.g. 2011 Toyota Tundra). Default 0.15.';
COMMENT ON COLUMN public.operating_cost_rates.trailer_maintenance_per_mile IS
  'Per-mile maintenance for the roll-off trailer (e.g. 2025 Sure-Trac). Default 0.07.';
UPDATE public.operating_cost_rates
SET
  truck_maintenance_per_mile = COALESCE(truck_maintenance_per_mile, 0.15),
  trailer_maintenance_per_mile = COALESCE(trailer_maintenance_per_mile, 0.07),
  maintenance_per_mile = COALESCE(truck_maintenance_per_mile, 0.15)
    + COALESCE(trailer_maintenance_per_mile, 0.07)
WHERE id = 1;
ALTER TABLE public.operating_cost_rates
  ALTER COLUMN truck_maintenance_per_mile SET DEFAULT 0.15,
  ALTER COLUMN trailer_maintenance_per_mile SET DEFAULT 0.07;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operating_cost_rates_truck_maint_check'
  ) THEN
    ALTER TABLE public.operating_cost_rates
      ADD CONSTRAINT operating_cost_rates_truck_maint_check
      CHECK (truck_maintenance_per_mile IS NULL OR truck_maintenance_per_mile >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operating_cost_rates_trailer_maint_check'
  ) THEN
    ALTER TABLE public.operating_cost_rates
      ADD CONSTRAINT operating_cost_rates_trailer_maint_check
      CHECK (trailer_maintenance_per_mile IS NULL OR trailer_maintenance_per_mile >= 0);
  END IF;
END $$;
