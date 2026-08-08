-- Widen mileage logging: any booking with known one-way miles; add booking_complete source

ALTER TABLE public.booking_mileage_logs
  DROP CONSTRAINT IF EXISTS booking_mileage_logs_source_check;

ALTER TABLE public.booking_mileage_logs
  ADD CONSTRAINT booking_mileage_logs_source_check
  CHECK (source IN ('booking_create', 'reschedule_address', 'backfill', 'booking_complete'));

-- Company delivery trip (for trip_kind labeling)
CREATE OR REPLACE FUNCTION public.booking_is_company_delivery(p_booking public.bookings)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_addons jsonb := COALESCE(p_booking.addons, '{}'::jsonb);
  v_plan jsonb := COALESCE(p_booking.plan, '{}'::jsonb);
  v_plan_id bigint;
  v_name text;
BEGIN
  IF COALESCE((v_addons->>'isDelivery')::boolean, false)
     OR COALESCE((v_addons->>'deliveryService')::boolean, false) THEN
    RETURN true;
  END IF;

  v_plan_id := NULLIF(v_plan->>'id', '')::bigint;
  v_name := lower(COALESCE(v_plan->>'name', ''));

  IF v_plan_id IN (1, 4) THEN
    RETURN true;
  END IF;
  IF v_plan_id = 2 AND COALESCE((v_addons->>'isDelivery')::boolean, false) THEN
    RETURN true;
  END IF;
  IF v_name LIKE '%delivery%' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Legacy name: now means "should appear in Financial Books mileage" (any known miles)
CREATE OR REPLACE FUNCTION public.booking_has_delivery_trip(p_booking public.bookings)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_customer_miles numeric;
  v_one_way numeric;
BEGIN
  SELECT c.distance_miles INTO v_customer_miles
  FROM public.customers c
  WHERE c.id = p_booking.customer_id;

  v_one_way := COALESCE(
    NULLIF(p_booking.distance_miles, 0),
    NULLIF(v_customer_miles, 0),
    NULLIF((p_booking.addons->>'oneWayDistanceMiles')::numeric, 0),
    0
  );

  RETURN v_one_way > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_booking_mileage_log(
  p_booking_id bigint,
  p_one_way_miles numeric DEFAULT NULL,
  p_source text DEFAULT 'booking_create',
  p_address_snapshot jsonb DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_customer_miles numeric;
  v_one_way numeric;
  v_trip_kind text;
  v_round numeric;
  v_service_id bigint;
  v_service_name text;
  v_service_type text;
  v_addr jsonb;
  v_id bigint;
  v_source text;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_source := COALESCE(NULLIF(trim(p_source), ''), 'booking_create');
  IF v_source NOT IN ('booking_create', 'reschedule_address', 'backfill', 'booking_complete') THEN
    v_source := 'booking_create';
  END IF;

  SELECT c.distance_miles INTO v_customer_miles
  FROM public.customers c
  WHERE c.id = v_booking.customer_id;

  v_one_way := COALESCE(
    NULLIF(p_one_way_miles, 0),
    NULLIF(v_booking.distance_miles, 0),
    NULLIF(v_customer_miles, 0),
    NULLIF((v_booking.addons->>'oneWayDistanceMiles')::numeric, 0),
    0
  );

  IF v_one_way <= 0 THEN
    RETURN NULL;
  END IF;

  -- Persist one-way onto booking when missing or caller supplied miles
  IF v_booking.distance_miles IS NULL OR v_booking.distance_miles = 0 OR p_one_way_miles IS NOT NULL THEN
    UPDATE public.bookings
    SET distance_miles = v_one_way
    WHERE id = p_booking_id;
  END IF;

  IF public.booking_is_company_delivery(v_booking) THEN
    v_trip_kind := 'delivery_pickup';
  ELSE
    v_trip_kind := 'one_way';
  END IF;

  -- Always store round-trip as one_way * 2 for Financial Books totals
  v_round := round(v_one_way * 2, 2);
  v_service_id := NULLIF(v_booking.plan->>'id', '')::bigint;
  v_service_name := COALESCE(v_booking.plan->>'name', 'Unknown Service');
  v_service_type := COALESCE(v_booking.plan->>'service_type', v_booking.delivery_type, 'rental');
  v_addr := COALESCE(
    p_address_snapshot,
    v_booking.delivery_address,
    jsonb_build_object(
      'street', v_booking.street,
      'city', v_booking.city,
      'state', v_booking.state,
      'zip', v_booking.zip
    )
  );

  INSERT INTO public.booking_mileage_logs (
    booking_id,
    customer_id,
    service_id,
    service_name,
    service_type,
    one_way_miles,
    round_trip_miles,
    trip_kind,
    address_snapshot,
    source,
    recorded_at,
    updated_at
  )
  VALUES (
    p_booking_id,
    v_booking.customer_id,
    v_service_id,
    v_service_name,
    v_service_type,
    round(v_one_way, 2),
    v_round,
    v_trip_kind,
    v_addr,
    v_source,
    now(),
    now()
  )
  ON CONFLICT (booking_id) DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    service_id = EXCLUDED.service_id,
    service_name = EXCLUDED.service_name,
    service_type = EXCLUDED.service_type,
    one_way_miles = EXCLUDED.one_way_miles,
    round_trip_miles = EXCLUDED.round_trip_miles,
    trip_kind = EXCLUDED.trip_kind,
    address_snapshot = EXCLUDED.address_snapshot,
    source = EXCLUDED.source,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_booking_mileage_log(bigint, numeric, text, jsonb)
  TO anon, authenticated, service_role;

-- Backfill: any booking with known one-way miles
INSERT INTO public.booking_mileage_logs (
  booking_id,
  customer_id,
  service_id,
  service_name,
  service_type,
  one_way_miles,
  round_trip_miles,
  trip_kind,
  address_snapshot,
  source,
  recorded_at,
  updated_at
)
SELECT
  b.id,
  b.customer_id,
  NULLIF(b.plan->>'id', '')::bigint,
  COALESCE(b.plan->>'name', 'Unknown Service'),
  COALESCE(b.plan->>'service_type', b.delivery_type, 'rental'),
  round(miles.one_way, 2),
  round(miles.one_way * 2, 2),
  CASE
    WHEN public.booking_is_company_delivery(b) THEN 'delivery_pickup'
    ELSE 'one_way'
  END,
  COALESCE(
    b.delivery_address,
    jsonb_build_object('street', b.street, 'city', b.city, 'state', b.state, 'zip', b.zip)
  ),
  'backfill',
  COALESCE(b.created_at, now()),
  now()
FROM public.bookings b
LEFT JOIN public.customers c ON c.id = b.customer_id
CROSS JOIN LATERAL (
  SELECT COALESCE(
    NULLIF(b.distance_miles, 0),
    NULLIF(c.distance_miles, 0),
    NULLIF((b.addons->>'oneWayDistanceMiles')::numeric, 0),
    0
  ) AS one_way
) miles
WHERE miles.one_way > 0
ON CONFLICT (booking_id) DO UPDATE SET
  one_way_miles = EXCLUDED.one_way_miles,
  round_trip_miles = EXCLUDED.round_trip_miles,
  trip_kind = EXCLUDED.trip_kind,
  service_name = EXCLUDED.service_name,
  service_type = EXCLUDED.service_type,
  updated_at = now();

-- Sync booking.distance_miles from customer when still zero
UPDATE public.bookings b
SET distance_miles = c.distance_miles
FROM public.customers c
WHERE b.customer_id = c.id
  AND (b.distance_miles IS NULL OR b.distance_miles = 0)
  AND c.distance_miles IS NOT NULL
  AND c.distance_miles > 0;
