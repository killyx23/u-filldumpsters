-- Homepage catalog flags and customer pickup on services (replaces hardcoded plan IDs in frontend)

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS show_on_homepage boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS homepage_highlight text,
  ADD COLUMN IF NOT EXISTS customer_pickup boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_variant_service_id integer REFERENCES public.services(id);

COMMENT ON COLUMN public.services.show_on_homepage IS 'Show on public booking homepage (Plans + Hero)';
COMMENT ON COLUMN public.services.display_order IS 'Sort order on homepage (lower first)';
COMMENT ON COLUMN public.services.homepage_highlight IS 'Optional badge text on plan card (e.g. Our Most Popular Service)';
COMMENT ON COLUMN public.services.customer_pickup IS 'Customer picks up at yard (self-service rental)';
COMMENT ON COLUMN public.services.delivery_variant_service_id IS 'When base service offers delivery, points to delivery service row (e.g. 2 -> 4)';

-- Backfill catalog rows
UPDATE public.services SET
  show_on_homepage = true,
  display_order = 1,
  homepage_highlight = 'Our Most Popular Service',
  customer_pickup = false
WHERE id = 1;

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 2,
  homepage_highlight = 'Incredible Value',
  customer_pickup = true,
  delivery_variant_service_id = 4
WHERE id = 2;

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 3,
  homepage_highlight = 'Save Money and Time',
  customer_pickup = false
WHERE id = 3;

UPDATE public.services SET
  show_on_homepage = false,
  display_order = 0,
  customer_pickup = false
WHERE id = 4;

UPDATE public.services SET
  show_on_homepage = true,
  display_order = 4,
  homepage_highlight = NULL,
  customer_pickup = true
WHERE id = 5;

UPDATE public.services SET
  show_on_homepage = false,
  display_order = 99,
  customer_pickup = false
WHERE id = 7;
