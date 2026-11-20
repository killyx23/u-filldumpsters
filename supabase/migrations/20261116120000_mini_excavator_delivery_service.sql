-- Mini Excavator with Delivery as its own service (id 6), linked from pickup (5 → 6).
-- Mirrors Dump Trailer delivery (2 → 4): optional customer toggle, window scheduling,
-- independent admin pricing (delivery fee / mileage / bands / additional day rate).

-- 1) Insert delivery variant from excavator base pricing + trailer-delivery fee shape
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
  additional_day_rate,
  service_type,
  homepage_price,
  homepage_price_unit,
  features,
  occupancy_model,
  mileage_rate,
  mileage_band2_miles,
  mileage_band2_rate,
  mileage_band3_miles,
  mileage_band3_rate,
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
  6,
  'Mini Excavator with Delivery',
  'Mini excavator delivery & pickup rental. We deliver the machine to your job site and pick it up when you are done. Same-day or multi-day rentals available.',
  excavator.base_price,
  excavator.price_unit,
  excavator.sale_price,
  'We deliver the mini excavator to your site and pick it up when the job is done. Same-day or multi-day rentals available.',
  excavator.weekly_rate,
  excavator.daily_rate,
  COALESCE(NULLIF(trailer_delivery.additional_day_rate, 0), excavator.additional_day_rate, 0),
  'window',
  excavator.homepage_price,
  excavator.homepage_price_unit,
  '["Company delivery & pickup", "No trailer required", "Fits through yard gates", "Same-day or multi-day rentals", "Book today, rent as early as tomorrow"]'::jsonb,
  COALESCE(trailer_delivery.occupancy_model, excavator.occupancy_model),
  COALESCE(trailer_delivery.mileage_rate, excavator.mileage_rate, 0.85),
  COALESCE(trailer_delivery.mileage_band2_miles, 30),
  COALESCE(trailer_delivery.mileage_band2_rate, trailer_delivery.mileage_rate, 0.85),
  COALESCE(trailer_delivery.mileage_band3_miles, 50),
  COALESCE(trailer_delivery.mileage_band3_rate, trailer_delivery.mileage_rate, 0.85),
  COALESCE(NULLIF(trailer_delivery.delivery_fee, 0), 125),
  excavator.is_taxable,
  COALESCE(trailer_delivery.delivery_fee_is_taxable, true),
  COALESCE(trailer_delivery.mileage_is_taxable, true),
  false,
  0,
  NULL,
  false,
  NULL,
  true
FROM public.services excavator
LEFT JOIN public.services trailer_delivery ON trailer_delivery.id = 4
WHERE excavator.id = 5
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  price_unit = EXCLUDED.price_unit,
  sale_price = EXCLUDED.sale_price,
  homepage_description = EXCLUDED.homepage_description,
  weekly_rate = EXCLUDED.weekly_rate,
  daily_rate = EXCLUDED.daily_rate,
  additional_day_rate = EXCLUDED.additional_day_rate,
  service_type = 'window',
  homepage_price = EXCLUDED.homepage_price,
  homepage_price_unit = EXCLUDED.homepage_price_unit,
  features = EXCLUDED.features,
  occupancy_model = EXCLUDED.occupancy_model,
  mileage_rate = EXCLUDED.mileage_rate,
  mileage_band2_miles = EXCLUDED.mileage_band2_miles,
  mileage_band2_rate = EXCLUDED.mileage_band2_rate,
  mileage_band3_miles = EXCLUDED.mileage_band3_miles,
  mileage_band3_rate = EXCLUDED.mileage_band3_rate,
  delivery_fee = EXCLUDED.delivery_fee,
  is_taxable = EXCLUDED.is_taxable,
  delivery_fee_is_taxable = EXCLUDED.delivery_fee_is_taxable,
  mileage_is_taxable = EXCLUDED.mileage_is_taxable,
  show_on_homepage = false,
  display_order = 0,
  homepage_highlight = NULL,
  customer_pickup = false,
  delivery_variant_service_id = NULL,
  is_rentable = true;
-- 2) Link Mini Excavator pickup → delivery variant
UPDATE public.services
SET delivery_variant_service_id = 6
WHERE id = 5;
-- 3) Weekly availability: clone delivery-window shape from trailer delivery (4)
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
  6,
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
WHERE sa.service_id = 4
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
-- 4) Date-specific availability: clone from trailer delivery (4)
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
  6,
  dsa.date,
  dsa.is_available,
  dsa.delivery_start_time,
  dsa.delivery_end_time,
  dsa.pickup_start_time,
  dsa.return_by_time,
  dsa.delivery_pickup_start_time,
  dsa.delivery_pickup_end_time
FROM public.date_specific_availability dsa
WHERE dsa.service_id = 4
ON CONFLICT (service_id, date) DO UPDATE SET
  is_available = EXCLUDED.is_available,
  delivery_start_time = EXCLUDED.delivery_start_time,
  delivery_end_time = EXCLUDED.delivery_end_time,
  pickup_start_time = EXCLUDED.pickup_start_time,
  return_by_time = EXCLUDED.return_by_time,
  delivery_pickup_start_time = EXCLUDED.delivery_pickup_start_time,
  delivery_pickup_end_time = EXCLUDED.delivery_pickup_end_time;
-- 5) Inventory rules: same excavator resource as pickup service 5
INSERT INTO public.inventory_rules (service_id, inventory_item_id, quantity_required)
SELECT
  6,
  ir.inventory_item_id,
  ir.quantity_required
FROM public.inventory_rules ir
WHERE ir.service_id = 5
ON CONFLICT (service_id, inventory_item_id) DO NOTHING;
-- Also cover any future base→variant copies via the generic pattern
INSERT INTO public.inventory_rules (service_id, inventory_item_id, quantity_required)
SELECT DISTINCT
  base.delivery_variant_service_id,
  ir.inventory_item_id,
  ir.quantity_required
FROM public.services base
JOIN public.inventory_rules ir ON ir.service_id = base.id
WHERE base.delivery_variant_service_id IS NOT NULL
ON CONFLICT (service_id, inventory_item_id) DO NOTHING;
-- 6) Protection plans: mirror excavator pickup links onto delivery variant
INSERT INTO public.protection_plan_services (protection_plan_id, service_id)
SELECT pps.protection_plan_id, 6
FROM public.protection_plan_services pps
WHERE pps.service_id = 5
ON CONFLICT (protection_plan_id, service_id) DO NOTHING;
