-- Migration A: Add is_taxable flags to services and equipment_pricing
-- Context: Utah tax law requires per-line-item taxability tracking.
-- Insurance (equipment_id=7) is a non-taxable item in Utah.

-- ─── services ────────────────────────────────────────────────────────────────
-- is_taxable covers the base_price column.
-- delivery_fee_is_taxable covers services.delivery_fee (taxable when incidental to a taxable rental).
-- mileage_is_taxable covers services.mileage_rate charges (taxable as part of delivery).
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS is_taxable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_fee_is_taxable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mileage_is_taxable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.services.is_taxable IS 'Whether the base rental price is subject to sales tax (Utah: tangible personal property rental is taxable)';
COMMENT ON COLUMN public.services.delivery_fee_is_taxable IS 'Whether the flat delivery fee is taxable (taxable in Utah when incidental to a taxable rental)';
COMMENT ON COLUMN public.services.mileage_is_taxable IS 'Whether distance/mileage charges are taxable (taxable in Utah as part of the delivery service)';

-- ─── equipment_pricing ───────────────────────────────────────────────────────
ALTER TABLE public.equipment_pricing
  ADD COLUMN IF NOT EXISTS is_taxable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.equipment_pricing.is_taxable IS 'Whether this equipment/item is subject to sales tax. Insurance (equipment_id=7) is non-taxable in Utah.';

-- Seed: insurance is non-taxable in Utah
UPDATE public.equipment_pricing
  SET is_taxable = false
  WHERE equipment_id = 7;
