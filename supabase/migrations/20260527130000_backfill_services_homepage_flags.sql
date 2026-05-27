-- Idempotent backfill if 20260527120000 ran before UPDATEs took effect or flags were reset

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 1,
  homepage_highlight = COALESCE(homepage_highlight, 'Our Most Popular Service'),
  customer_pickup = false
WHERE id = 1 AND show_on_homepage IS NOT TRUE;

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 2,
  homepage_highlight = COALESCE(homepage_highlight, 'Incredible Value'),
  customer_pickup = true,
  delivery_variant_service_id = 4
WHERE id = 2 AND show_on_homepage IS NOT TRUE;

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 3,
  homepage_highlight = COALESCE(homepage_highlight, 'Save Money and Time'),
  customer_pickup = false
WHERE id = 3 AND show_on_homepage IS NOT TRUE;

UPDATE public.services SET
  show_on_homepage = false,
  display_order = 0,
  customer_pickup = false
WHERE id = 4;

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 4,
  customer_pickup = true
WHERE id = 5 AND show_on_homepage IS NOT TRUE;

UPDATE public.services SET
  show_on_homepage = false,
  display_order = 99,
  customer_pickup = false
WHERE id = 7;
