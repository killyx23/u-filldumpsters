-- Delivery trips use customer_gps_miles as a signed truck-vs-GPS difference.
-- Pickup trips keep it as non-negative trailer GPS extras.
-- Audit note explains nonzero delivery differences.

ALTER TABLE public.booking_mileage_logs
  ADD COLUMN IF NOT EXISTS customer_gps_miles_note text;
COMMENT ON COLUMN public.booking_mileage_logs.customer_gps_miles IS
  'Pickup: extra trailer GPS miles while the customer has the trailer (non-negative). Delivery: signed truck odometer vs GPS/route difference added into company truck miles.';
COMMENT ON COLUMN public.booking_mileage_logs.customer_gps_miles_note IS
  'Audit reason when a nonzero delivery truck mileage difference is recorded.';
