-- Delivery mileage bands. The existing mileage_rate covers miles after the
-- free included miles up to mileage_band2_miles. mileage_band2_rate covers
-- the miles until mileage_band3_miles. mileage_band3_rate covers the rest.
-- A null band rate means "use mileage_rate", so existing deliveries stay the same.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS mileage_band2_miles numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS mileage_band2_rate numeric,
  ADD COLUMN IF NOT EXISTS mileage_band3_miles numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS mileage_band3_rate numeric;

COMMENT ON COLUMN public.services.mileage_band2_miles IS
  'Mile mark where the second delivery mileage rate starts. Default 30.';
COMMENT ON COLUMN public.services.mileage_band2_rate IS
  'Dollars per mile from mileage_band2_miles until mileage_band3_miles. Null uses mileage_rate.';
COMMENT ON COLUMN public.services.mileage_band3_miles IS
  'Mile mark where the third delivery mileage rate starts. Default 50.';
COMMENT ON COLUMN public.services.mileage_band3_rate IS
  'Dollars per mile after mileage_band3_miles. Null uses mileage_rate.';

-- Recreate so services.* includes the new columns.
DROP VIEW IF EXISTS public.services_resolved;
CREATE VIEW public.services_resolved AS
SELECT
  s.*,
  g.slug AS group_slug,
  g.name AS group_name,
  g.description AS group_description,
  g.display_order AS group_display_order,
  coalesce(s.slot_interval_minutes, (g.defaults->>'slot_interval_minutes')::integer) AS resolved_slot_interval_minutes,
  coalesce(s.price_unit, g.defaults->>'price_unit') AS resolved_price_unit,
  coalesce(s.homepage_price_unit, g.defaults->>'homepage_price_unit') AS resolved_homepage_price_unit,
  coalesce(s.homepage_highlight, g.defaults->>'homepage_highlight') AS resolved_homepage_highlight,
  pl.label AS promo_label
FROM public.services s
LEFT JOIN public.service_groups g ON g.id = s.group_id
LEFT JOIN public.pricing_promo_labels pl ON pl.id = s.promo_label_id;

COMMENT ON VIEW public.services_resolved IS
  'Services left-joined to their group and optional pricing promo label.';

GRANT SELECT ON public.services_resolved TO anon, authenticated, service_role;
