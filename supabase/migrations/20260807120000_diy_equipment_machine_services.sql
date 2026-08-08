-- DIY Heavy Equipment machine picker:
-- - Service 5 becomes Mini Excavator (keeps homepage card + existing availability)
-- - Service 8 is Mini Telescoping Loader 3 in 1 (cloned from 5, not on homepage)
-- Homepage UI continues to display "DIY Heavy Equipment" for id 5 via frontend override.

UPDATE public.services SET
  name = 'Mini Excavator',
  description = 'Mini excavator rental for digging, trenching, grading, and small excavation projects. Same-day or multi-day rentals available. (Pick up location is in South Saratoga Springs.)',
  homepage_description = COALESCE(
    NULLIF(trim(homepage_description), ''),
    'Tackle tough backyard projects without the strain. Our compact machinery fits through standard yard gates to deliver heavy-duty digging and lifting power in tight spaces.'
  ),
  homepage_highlight = COALESCE(NULLIF(trim(homepage_highlight), ''), 'Save Your Back & Time'),
  show_on_homepage = true,
  customer_pickup = true,
  service_type = COALESCE(service_type, 'hourly'),
  is_rentable = true
WHERE id = 5;

INSERT INTO public.services (
  id,
  name,
  description,
  base_price,
  price_unit,
  sale_price,
  homepage_description,
  weekly_rate,
  daily_rate,
  service_type,
  homepage_price,
  homepage_price_unit,
  features,
  occupancy_model,
  mileage_rate,
  delivery_fee,
  is_taxable,
  delivery_fee_is_taxable,
  mileage_is_taxable,
  show_on_homepage,
  display_order,
  homepage_highlight,
  customer_pickup,
  delivery_variant_service_id,
  is_rentable
)
SELECT
  8,
  'Mini Telescoping Loader 3 in 1',
  'Mini telescoping loader rental for lifting, loading, and compact landscaping projects. Same-day or multi-day rentals available. (Pick up location is in South Saratoga Springs.)',
  s.base_price,
  s.price_unit,
  s.sale_price,
  'Compact telescoping loader for backyard lifting and material moving. Fits through gates and tight spaces. Same-day or multi-day rentals available.',
  s.weekly_rate,
  s.daily_rate,
  COALESCE(s.service_type, 'hourly'),
  s.homepage_price,
  s.homepage_price_unit,
  '["You pick up & return", "Easy Self-Serve Rental No-Contact, Hassle-Free", "Great for lifting and loading", "Fits through gates & narrow spaces", "Book today, rent as early as tomorrow", "Saves days of hard physical labor"]'::jsonb,
  s.occupancy_model,
  s.mileage_rate,
  s.delivery_fee,
  s.is_taxable,
  s.delivery_fee_is_taxable,
  s.mileage_is_taxable,
  false,
  0,
  NULL,
  true,
  NULL,
  true
FROM public.services s
WHERE s.id = 5
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  price_unit = EXCLUDED.price_unit,
  sale_price = EXCLUDED.sale_price,
  homepage_description = EXCLUDED.homepage_description,
  weekly_rate = EXCLUDED.weekly_rate,
  daily_rate = EXCLUDED.daily_rate,
  service_type = EXCLUDED.service_type,
  homepage_price = EXCLUDED.homepage_price,
  homepage_price_unit = EXCLUDED.homepage_price_unit,
  features = EXCLUDED.features,
  occupancy_model = EXCLUDED.occupancy_model,
  mileage_rate = EXCLUDED.mileage_rate,
  delivery_fee = EXCLUDED.delivery_fee,
  is_taxable = EXCLUDED.is_taxable,
  delivery_fee_is_taxable = EXCLUDED.delivery_fee_is_taxable,
  mileage_is_taxable = EXCLUDED.mileage_is_taxable,
  show_on_homepage = false,
  display_order = 0,
  homepage_highlight = NULL,
  customer_pickup = true,
  delivery_variant_service_id = NULL,
  is_rentable = true;

-- Clone weekly availability from Mini Excavator (5) → Loader (8)
INSERT INTO public.service_availability (
  service_id,
  day_of_week,
  created_at,
  updated_at,
  time_type,
  delivery_window_start_time,
  delivery_window_end_time,
  pickup_start_time,
  pickup_end_time,
  return_by_time,
  return_end_time,
  is_available,
  delivery_pickup_window_start_time,
  delivery_pickup_window_end_time
)
SELECT
  8,
  sa.day_of_week,
  now(),
  now(),
  sa.time_type,
  sa.delivery_window_start_time,
  sa.delivery_window_end_time,
  sa.pickup_start_time,
  sa.pickup_end_time,
  sa.return_by_time,
  sa.return_end_time,
  sa.is_available,
  sa.delivery_pickup_window_start_time,
  sa.delivery_pickup_window_end_time
FROM public.service_availability sa
WHERE sa.service_id = 5
ON CONFLICT (service_id, day_of_week) DO UPDATE SET
  time_type = EXCLUDED.time_type,
  delivery_window_start_time = EXCLUDED.delivery_window_start_time,
  delivery_window_end_time = EXCLUDED.delivery_window_end_time,
  pickup_start_time = EXCLUDED.pickup_start_time,
  pickup_end_time = EXCLUDED.pickup_end_time,
  return_by_time = EXCLUDED.return_by_time,
  return_end_time = EXCLUDED.return_end_time,
  is_available = EXCLUDED.is_available,
  delivery_pickup_window_start_time = EXCLUDED.delivery_pickup_window_start_time,
  delivery_pickup_window_end_time = EXCLUDED.delivery_pickup_window_end_time,
  updated_at = now();

-- Clone date-specific availability from 5 → 8
INSERT INTO public.date_specific_availability (
  service_id,
  date,
  is_available,
  delivery_start_time,
  delivery_end_time,
  pickup_start_time,
  return_by_time,
  delivery_pickup_start_time,
  delivery_pickup_end_time
)
SELECT
  8,
  dsa.date,
  dsa.is_available,
  dsa.delivery_start_time,
  dsa.delivery_end_time,
  dsa.pickup_start_time,
  dsa.return_by_time,
  dsa.delivery_pickup_start_time,
  dsa.delivery_pickup_end_time
FROM public.date_specific_availability dsa
WHERE dsa.service_id = 5
ON CONFLICT (service_id, date) DO UPDATE SET
  is_available = EXCLUDED.is_available,
  delivery_start_time = EXCLUDED.delivery_start_time,
  delivery_end_time = EXCLUDED.delivery_end_time,
  pickup_start_time = EXCLUDED.pickup_start_time,
  return_by_time = EXCLUDED.return_by_time,
  delivery_pickup_start_time = EXCLUDED.delivery_pickup_start_time,
  delivery_pickup_end_time = EXCLUDED.delivery_pickup_end_time;

-- Mirror protection-plan links from Mini Excavator (5) onto Loader (8)
INSERT INTO public.protection_plan_services (protection_plan_id, service_id)
SELECT pps.protection_plan_id, 8
FROM public.protection_plan_services pps
WHERE pps.service_id = 5
ON CONFLICT (protection_plan_id, service_id) DO NOTHING;
