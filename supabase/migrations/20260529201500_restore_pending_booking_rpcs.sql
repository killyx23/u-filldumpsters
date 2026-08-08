-- Hotfix: restore checkout pending-booking RPCs used by step 7/8 flows.

CREATE OR REPLACE FUNCTION public.get_pending_customer_by_id(p_id uuid)
RETURNS SETOF public.pending_customers
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.pending_customers
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.store_pending_booking(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_existing_id uuid;
  v_record_id uuid;
BEGIN
  v_email := lower(trim(payload->>'email'));
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  SELECT id INTO v_existing_id
  FROM public.pending_customers
  WHERE lower(email) = v_email
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.pending_customers
    SET
      email = v_email,
      first_name = payload->>'first_name',
      last_name = payload->>'last_name',
      name = payload->>'name',
      phone = payload->>'phone',
      street = payload->>'street',
      city = payload->>'city',
      state = payload->>'state',
      zip = payload->>'zip',
      contact_address = payload->'contact_address',
      delivery_address = payload->'delivery_address',
      drop_off_date = (payload->>'drop_off_date')::date,
      pickup_date = (payload->>'pickup_date')::date,
      drop_off_time_slot = payload->>'drop_off_time_slot',
      pickup_time_slot = payload->>'pickup_time_slot',
      notes = payload->>'notes',
      service_id = (payload->>'service_id')::integer,
      plan_data = payload->'plan_data',
      addons_data = payload->'addons_data',
      booking_data = payload->'booking_data',
      total_price = (payload->>'total_price')::numeric,
      base_price = (payload->>'base_price')::numeric,
      delivery_service = COALESCE((payload->>'delivery_service')::boolean, false),
      is_verified = false,
      verified_at = null,
      created_at = now()
    WHERE id = v_existing_id;

    RETURN v_existing_id;
  END IF;

  INSERT INTO public.pending_customers (
    email, first_name, last_name, name, phone, street, city, state, zip,
    contact_address, delivery_address, drop_off_date, pickup_date,
    drop_off_time_slot, pickup_time_slot, notes, service_id, plan_data,
    addons_data, booking_data, total_price, base_price, delivery_service,
    is_verified, verified_at
  )
  VALUES (
    v_email,
    payload->>'first_name',
    payload->>'last_name',
    payload->>'name',
    payload->>'phone',
    payload->>'street',
    payload->>'city',
    payload->>'state',
    payload->>'zip',
    payload->'contact_address',
    payload->'delivery_address',
    (payload->>'drop_off_date')::date,
    (payload->>'pickup_date')::date,
    payload->>'drop_off_time_slot',
    payload->>'pickup_time_slot',
    payload->>'notes',
    (payload->>'service_id')::integer,
    payload->'plan_data',
    payload->'addons_data',
    payload->'booking_data',
    (payload->>'total_price')::numeric,
    (payload->>'base_price')::numeric,
    COALESCE((payload->>'delivery_service')::boolean, false),
    false,
    null
  )
  RETURNING id INTO v_record_id;

  RETURN v_record_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_customer_by_id(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_pending_booking(jsonb) TO anon, authenticated, service_role;
