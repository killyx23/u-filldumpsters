BEGIN;
-- ─── Migration A: is_taxable on services & equipment_pricing ───────────────
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS is_taxable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_fee_is_taxable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mileage_is_taxable boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.services.is_taxable IS 'Whether the base rental price is subject to sales tax (Utah: tangible personal property rental is taxable)';
COMMENT ON COLUMN public.services.delivery_fee_is_taxable IS 'Whether the flat delivery fee is taxable (taxable in Utah when incidental to a taxable rental)';
COMMENT ON COLUMN public.services.mileage_is_taxable IS 'Whether distance/mileage charges are taxable (taxable in Utah as part of the delivery service)';
ALTER TABLE public.equipment_pricing
  ADD COLUMN IF NOT EXISTS is_taxable boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.equipment_pricing.is_taxable IS 'Whether this equipment/item is subject to sales tax. Insurance (equipment_id=7) is non-taxable in Utah.';
UPDATE public.equipment_pricing
SET is_taxable = false
WHERE equipment_id = 7;
-- ─── Migration B: business_settings pickup/delivery columns + bookings default
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS tax_rate_pickup numeric DEFAULT 7.45,
  ADD COLUMN IF NOT EXISTS tax_rate_delivery numeric DEFAULT 7.45;
COMMENT ON COLUMN public.business_settings.tax_rate_pickup IS 'Sales tax rate (%) for self-pickup transactions at business location (Saratoga Springs, UT: 7.45%)';
COMMENT ON COLUMN public.business_settings.tax_rate_delivery IS 'Default sales tax rate (%) for delivery transactions when no tax API lookup is available';
UPDATE public.business_settings
SET tax_rate_pickup   = COALESCE(tax_rate, 7.45),
    tax_rate_delivery = COALESCE(tax_rate, 7.45)
WHERE id = 1;
ALTER TABLE public.bookings
  ALTER COLUMN tax_rate_used SET DEFAULT 7.45;
-- ─── Migration C: bookings.delivery_type + backfill ───────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS delivery_type text
  CHECK (delivery_type IN ('delivery', 'self_service_trailer', 'self_pickup'));
COMMENT ON COLUMN public.bookings.delivery_type IS 'Delivery mode for this booking: delivery=we bring to customer, self_service_trailer=customer loads at site, self_pickup=customer collects from us.';
UPDATE public.bookings
SET delivery_type = CASE
  WHEN (addons->>'isDelivery') IN ('true', 'True', '1') THEN 'delivery'
  WHEN (plan->>'id')::int = 2
       AND COALESCE((addons->>'isDelivery'), 'false') NOT IN ('true', 'True', '1')
       THEN 'self_service_trailer'
  WHEN (plan->>'id')::int IN (1, 4) THEN 'delivery'
  ELSE 'delivery'
END
WHERE delivery_type IS NULL;
-- ─── Migration D: extend tax_records ────────────────────────────────────────
ALTER TABLE public.tax_records
  ADD COLUMN IF NOT EXISTS delivery_type text
    CHECK (delivery_type IN ('delivery', 'self_service_trailer', 'self_pickup')),
  ADD COLUMN IF NOT EXISTS taxable_subtotal numeric,
  ADD COLUMN IF NOT EXISTS non_taxable_subtotal numeric,
  ADD COLUMN IF NOT EXISTS line_items jsonb,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction text,
  ADD COLUMN IF NOT EXISTS tax_api_used boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.tax_records.delivery_type IS 'Delivery mode at the time of booking; mirrors bookings.delivery_type';
COMMENT ON COLUMN public.tax_records.taxable_subtotal IS 'Subtotal of taxable line items only, before discount';
COMMENT ON COLUMN public.tax_records.non_taxable_subtotal IS 'Subtotal of non-taxable line items (e.g., insurance/damage waivers)';
COMMENT ON COLUMN public.tax_records.line_items IS 'Snapshot of all charge line items: [{label, amount, is_taxable}]';
COMMENT ON COLUMN public.tax_records.tax_jurisdiction IS 'Tax jurisdiction string, e.g. Saratoga Springs, UT 84045';
COMMENT ON COLUMN public.tax_records.tax_api_used IS 'True when a real-time tax API supplied the rate; false when business_settings fallback was used';
-- ─── Migration E: tax_rate_cache (optional TaxJar cache) ──────────────────────
CREATE TABLE IF NOT EXISTS public.tax_rate_cache (
  zip_code     text PRIMARY KEY,
  rate         numeric NOT NULL,
  jurisdiction text,
  state_rate   numeric,
  county_rate  numeric,
  city_rate    numeric,
  fetched_at   timestamp with time zone NOT NULL DEFAULT now(),
  created_at   timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.tax_rate_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_full_access" ON public.tax_rate_cache;
CREATE POLICY "service_role_full_access" ON public.tax_rate_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);
COMMENT ON TABLE public.tax_rate_cache IS
  'Cache of ZIP-code sales tax rates from TaxJar. TTL enforced by lookup-tax-rate edge function (30 days).';
COMMENT ON COLUMN public.tax_rate_cache.rate IS
  'Combined state+county+city rate as a percentage (e.g. 7.45 for 7.45%)';
INSERT INTO public.tax_rate_cache (zip_code, rate, jurisdiction, state_rate, county_rate, city_rate)
VALUES ('84045', 7.45, 'Saratoga Springs, UT 84045', 4.85, 2.0, 0.6)
ON CONFLICT (zip_code) DO NOTHING;


SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('services', 'equipment_pricing', 'business_settings', 'bookings', 'tax_records', 'tax_rate_cache')
  AND column_name IN (
    'is_taxable', 'delivery_fee_is_taxable', 'mileage_is_taxable',
    'tax_rate_pickup', 'tax_rate_delivery',
    'delivery_type',
    'taxable_subtotal', 'non_taxable_subtotal', 'line_items', 'tax_jurisdiction', 'tax_api_used'
  )
ORDER BY table_name, column_name;
SELECT id, tax_rate, tax_rate_pickup, tax_rate_delivery
FROM public.business_settings
WHERE id = 1;
SELECT COUNT(*) FILTER (WHERE delivery_type IS NOT NULL) AS with_delivery_type,
       COUNT(*) AS total
FROM public.bookings;
SELECT equipment_id, is_taxable
FROM public.equipment_pricing
WHERE equipment_id = 7;
SELECT COUNT(*) FROM public.tax_rate_cache WHERE zip_code = '84045';


COMMIT;