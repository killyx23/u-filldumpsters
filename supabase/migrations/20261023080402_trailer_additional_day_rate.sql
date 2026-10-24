-- Dump trailer with delivery (service 4): base price is the first day.
-- additional_day_rate is charged once for each day after the first.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS additional_day_rate numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.services.additional_day_rate IS
  'Dump trailer delivery only: charge for each day after the first. Other services ignore it.';

-- Recreate so services.* includes additional_day_rate.
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
