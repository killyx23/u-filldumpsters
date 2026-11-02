-- Extra trailer GPS miles while the customer has the trailer.
-- Edited by hand on the Financial Books trip log. Automatic one-way and
-- round-trip miles are left alone, including later upserts.

ALTER TABLE public.booking_mileage_logs
  ADD COLUMN IF NOT EXISTS customer_gps_miles numeric(10, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.booking_mileage_logs.customer_gps_miles IS
  'Extra miles from the trailer GPS while the customer has the trailer. Added on top of automatic round-trip miles.';
