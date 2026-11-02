-- Truck operating costs used by Financial Books.
-- The six inputs are editable. Fuel per mile, labor per minute, and the
-- truck cost per mile are calculated from these inputs for every booking.

CREATE TABLE IF NOT EXISTS public.operating_cost_rates (
  id integer PRIMARY KEY DEFAULT 1,
  fuel_price_per_gallon numeric(10, 4) NOT NULL DEFAULT 5,
  truck_mpg numeric(10, 4) NOT NULL DEFAULT 8,
  maintenance_per_mile numeric(10, 4) NOT NULL DEFAULT 0.220,
  driver_hourly_rate numeric(10, 4) NOT NULL DEFAULT 30,
  landfill_ticket numeric(10, 2) NOT NULL DEFAULT 45,
  landfill_one_way_miles numeric(10, 2) NOT NULL DEFAULT 27,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operating_cost_rates_singleton CHECK (id = 1),
  CONSTRAINT operating_cost_rates_fuel_price_check CHECK (fuel_price_per_gallon >= 0),
  CONSTRAINT operating_cost_rates_mpg_check CHECK (truck_mpg > 0),
  CONSTRAINT operating_cost_rates_maintenance_check CHECK (maintenance_per_mile >= 0),
  CONSTRAINT operating_cost_rates_labor_check CHECK (driver_hourly_rate >= 0),
  CONSTRAINT operating_cost_rates_ticket_check CHECK (landfill_ticket >= 0),
  CONSTRAINT operating_cost_rates_landfill_miles_check CHECK (landfill_one_way_miles >= 0)
);

INSERT INTO public.operating_cost_rates (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.operating_cost_rates IS
  'Editable truck cost inputs. Per-mile fuel and labor rates are derived, not stored.';

ALTER TABLE public.operating_cost_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operating_cost_rates_admin_all ON public.operating_cost_rates;
CREATE POLICY operating_cost_rates_admin_all
  ON public.operating_cost_rates
  FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

GRANT SELECT, UPDATE ON public.operating_cost_rates TO authenticated, service_role;

-- Per-booking corrections. Null means use the calculated value.
ALTER TABLE public.booking_mileage_logs
  ADD COLUMN IF NOT EXISTS truck_miles_override numeric(10, 2),
  ADD COLUMN IF NOT EXISTS driver_minutes_override numeric(10, 2),
  ADD COLUMN IF NOT EXISTS landfill_haul_override boolean;

COMMENT ON COLUMN public.booking_mileage_logs.truck_miles_override IS
  'Company truck miles for this booking. Null uses the logged round trip plus the landfill round trip when a landfill haul applies.';
COMMENT ON COLUMN public.booking_mileage_logs.driver_minutes_override IS
  'Driver minutes for this booking. Null uses stored one-way drive time doubled when the company truck makes the trip.';
COMMENT ON COLUMN public.booking_mileage_logs.landfill_haul_override IS
  'Whether this booking includes a company landfill haul. Null follows delivery vs customer-pickup.';
