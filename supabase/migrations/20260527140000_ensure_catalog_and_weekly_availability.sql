-- Ensure homepage catalog flags and weekly availability for self-pickup services.
-- Idempotent: safe on migration up for existing DBs; seed.sql carries the same values on db reset.

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 1,
  homepage_highlight = COALESCE(homepage_highlight, 'Our Most Popular Service'),
  customer_pickup = false,
  delivery_variant_service_id = NULL
WHERE id = 1;

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 2,
  homepage_highlight = COALESCE(homepage_highlight, 'Incredible Value'),
  customer_pickup = true,
  delivery_variant_service_id = 4
WHERE id = 2;

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 3,
  homepage_highlight = COALESCE(homepage_highlight, 'Save Money and Time'),
  customer_pickup = false,
  delivery_variant_service_id = NULL
WHERE id = 3;

UPDATE public.services SET
  show_on_homepage = false,
  display_order = 0,
  homepage_highlight = NULL,
  customer_pickup = false,
  delivery_variant_service_id = NULL
WHERE id = 4;

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 4,
  homepage_highlight = NULL,
  customer_pickup = true,
  delivery_variant_service_id = NULL
WHERE id = 5;

UPDATE public.services SET
  show_on_homepage = false,
  display_order = 99,
  homepage_highlight = NULL,
  customer_pickup = false,
  delivery_variant_service_id = NULL
WHERE id = 7;

INSERT INTO public.service_availability
  (service_id, day_of_week, is_available, pickup_start_time, return_by_time)
SELECT s, d, true, '06:00:00', '23:00:00'
FROM (VALUES (2), (5)) AS svc(s)
CROSS JOIN generate_series(0, 6) AS d
WHERE EXISTS (SELECT 1 FROM public.services WHERE services.id = s)
ON CONFLICT (service_id, day_of_week) DO UPDATE SET
  is_available = EXCLUDED.is_available,
  pickup_start_time = EXCLUDED.pickup_start_time,
  return_by_time = EXCLUDED.return_by_time,
  updated_at = now();
