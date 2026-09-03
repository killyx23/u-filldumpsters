-- Fix idle reminded teardown: fresh pending rows + CRM reminded precedence

-- ---------------------------------------------------------------------------
-- 1) store_pending_booking — clear terminal booking_id on new checkout attempt
-- ---------------------------------------------------------------------------
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
  v_drop_off_raw text;
  v_pickup_raw text;
  v_service_id_raw text;
  v_total_price_raw text;
  v_base_price_raw text;
  v_delivery_service_raw text;
  v_drop_off_date date;
  v_pickup_date date;
  v_service_id integer;
  v_total_price numeric;
  v_base_price numeric;
  v_delivery_service boolean;
  v_email_preverified boolean;
  v_mark_verified boolean;
BEGIN
  v_email := lower(trim(payload->>'email'));
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  v_email_preverified := lower(coalesce(payload->>'email_preverified', 'false')) IN ('true', 't', '1', 'yes', 'y', 'on');
  v_mark_verified := false;

  IF v_email_preverified THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.email_verifications ev
      WHERE lower(ev.email) = v_email
        AND ev.is_verified = true
    ) INTO v_mark_verified;
  END IF;

  v_drop_off_raw := NULLIF(trim(payload->>'drop_off_date'), '');
  v_pickup_raw := NULLIF(trim(payload->>'pickup_date'), '');
  v_service_id_raw := NULLIF(trim(payload->>'service_id'), '');
  v_total_price_raw := NULLIF(trim(payload->>'total_price'), '');
  v_base_price_raw := NULLIF(trim(payload->>'base_price'), '');
  v_delivery_service_raw := NULLIF(trim(payload->>'delivery_service'), '');

  IF v_drop_off_raw IS NULL THEN
    v_drop_off_date := NULL;
  ELSE
    BEGIN
      v_drop_off_date := (substring(v_drop_off_raw from '^(\d{4}-\d{2}-\d{2})'))::date;
    EXCEPTION WHEN others THEN
      v_drop_off_date := NULL;
    END;
  END IF;

  IF v_pickup_raw IS NULL THEN
    v_pickup_date := NULL;
  ELSE
    BEGIN
      v_pickup_date := (substring(v_pickup_raw from '^(\d{4}-\d{2}-\d{2})'))::date;
    EXCEPTION WHEN others THEN
      v_pickup_date := NULL;
    END;
  END IF;

  IF v_service_id_raw IS NOT NULL AND v_service_id_raw ~ '^-?\d+$' THEN
    v_service_id := v_service_id_raw::integer;
  ELSE
    v_service_id := NULL;
  END IF;

  IF v_total_price_raw IS NOT NULL AND v_total_price_raw ~ '^-?\d+(\.\d+)?$' THEN
    v_total_price := v_total_price_raw::numeric;
  ELSE
    v_total_price := NULL;
  END IF;

  IF v_base_price_raw IS NOT NULL AND v_base_price_raw ~ '^-?\d+(\.\d+)?$' THEN
    v_base_price := v_base_price_raw::numeric;
  ELSE
    v_base_price := NULL;
  END IF;

  IF v_delivery_service_raw IS NULL THEN
    v_delivery_service := false;
  ELSE
    CASE lower(v_delivery_service_raw)
      WHEN 'true' THEN v_delivery_service := true;
      WHEN 't' THEN v_delivery_service := true;
      WHEN '1' THEN v_delivery_service := true;
      WHEN 'yes' THEN v_delivery_service := true;
      WHEN 'y' THEN v_delivery_service := true;
      WHEN 'on' THEN v_delivery_service := true;
      WHEN 'false' THEN v_delivery_service := false;
      WHEN 'f' THEN v_delivery_service := false;
      WHEN '0' THEN v_delivery_service := false;
      WHEN 'no' THEN v_delivery_service := false;
      WHEN 'n' THEN v_delivery_service := false;
      WHEN 'off' THEN v_delivery_service := false;
      ELSE v_delivery_service := false;
    END CASE;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.pending_customers
  WHERE lower(email) = v_email
  ORDER BY
    CASE WHEN email = v_email THEN 0 ELSE 1 END,
    created_at DESC,
    id DESC
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
      drop_off_date = v_drop_off_date,
      pickup_date = v_pickup_date,
      drop_off_time_slot = payload->>'drop_off_time_slot',
      pickup_time_slot = payload->>'pickup_time_slot',
      notes = payload->>'notes',
      service_id = v_service_id,
      plan_data = payload->'plan_data',
      addons_data = payload->'addons_data',
      booking_data = payload->'booking_data',
      total_price = v_total_price,
      base_price = v_base_price,
      delivery_service = v_delivery_service,
      is_verified = CASE WHEN v_mark_verified THEN true ELSE false END,
      verified_at = CASE WHEN v_mark_verified THEN now() ELSE null END,
      booking_id = CASE
        WHEN booking_id IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM public.bookings b
               WHERE b.id = booking_id
                 AND lower(COALESCE(b.status, '')) IN (
                   'booking_not_finished', 'cancelled', 'canceled'
                 )
             )
          THEN NULL
        ELSE booking_id
      END,
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
    v_drop_off_date,
    v_pickup_date,
    payload->>'drop_off_time_slot',
    payload->>'pickup_time_slot',
    payload->>'notes',
    v_service_id,
    payload->'plan_data',
    payload->'addons_data',
    payload->'booking_data',
    v_total_price,
    v_base_price,
    v_delivery_service,
    v_mark_verified,
    CASE WHEN v_mark_verified THEN now() ELSE null END
  )
  RETURNING id INTO v_record_id;

  RETURN v_record_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.store_pending_booking(jsonb) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) upsert_abandoned_checkout_from_booking — idle reminded overrides left_early
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_abandoned_checkout_from_booking(
  p_booking_id bigint,
  p_status text DEFAULT 'expired',
  p_set_reminder_sent boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  v_service_name text;
  v_id bigint;
  v_cart jsonb;
  v_source text;
  v_tags text[];
  v_status text;
BEGIN
  v_status := lower(COALESCE(NULLIF(trim(p_status), ''), 'expired'));

  IF p_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
    INTO b
    FROM public.bookings
   WHERE id = p_booking_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF COALESCE(b.email, '') = '' THEN
    RETURN NULL;
  END IF;

  v_source := CASE
    WHEN v_status = 'left_early' THEN 'left_early'
    ELSE 'pending_payment'
  END;

  v_service_name := COALESCE(
    NULLIF(b.plan->>'name', ''),
    NULLIF(b.plan->'name'->>'name', ''),
    'Service'
  );

  v_tags := public.abandoned_checkout_service_tags(v_service_name, b.plan, b.addons);

  v_cart := jsonb_build_object(
    'booking_id', b.id,
    'plan', b.plan,
    'addons', b.addons,
    'contact_address', b.contact_address,
    'delivery_address', b.delivery_address,
    'drop_off_date', b.drop_off_date,
    'pickup_date', b.pickup_date,
    'drop_off_time_slot', b.drop_off_time_slot,
    'pickup_time_slot', b.pickup_time_slot,
    'total_price', b.total_price,
    'subtotal_before_tax', b.subtotal_before_tax,
    'tax_amount', b.tax_amount,
    'distance_miles', b.distance_miles
  );

  INSERT INTO public.abandoned_checkouts AS ac (
    email,
    phone,
    full_name,
    source,
    booking_id,
    service_name,
    plan,
    addons,
    cart_snapshot,
    total_price,
    drop_off_date,
    pickup_date,
    status,
    reminder_sent_at,
    expired_at,
    marketing_eligible,
    tags,
    meta
  )
  VALUES (
    lower(trim(b.email)),
    NULLIF(b.phone, ''),
    NULLIF(trim(COALESCE(b.name, concat_ws(' ', b.first_name, b.last_name))), ''),
    v_source,
    b.id,
    v_service_name,
    b.plan,
    b.addons,
    v_cart,
    b.total_price,
    b.drop_off_date::date,
    b.pickup_date::date,
    v_status,
    CASE WHEN p_set_reminder_sent OR v_status = 'reminded' THEN now() ELSE NULL END,
    CASE WHEN v_status = 'expired' THEN now() ELSE NULL END,
    true,
    v_tags,
    jsonb_build_object('last_source_status', b.status)
  )
  ON CONFLICT (booking_id)
  DO UPDATE SET
    email = EXCLUDED.email,
    phone = COALESCE(EXCLUDED.phone, ac.phone),
    full_name = COALESCE(EXCLUDED.full_name, ac.full_name),
    source = CASE
      WHEN EXCLUDED.source = 'left_early' THEN EXCLUDED.source
      WHEN ac.source = 'left_early' THEN ac.source
      ELSE COALESCE(ac.source, EXCLUDED.source)
    END,
    service_name = COALESCE(EXCLUDED.service_name, ac.service_name),
    plan = COALESCE(EXCLUDED.plan, ac.plan),
    addons = COALESCE(EXCLUDED.addons, ac.addons),
    cart_snapshot = COALESCE(EXCLUDED.cart_snapshot, ac.cart_snapshot),
    total_price = COALESCE(EXCLUDED.total_price, ac.total_price),
    drop_off_date = COALESCE(EXCLUDED.drop_off_date, ac.drop_off_date),
    pickup_date = COALESCE(EXCLUDED.pickup_date, ac.pickup_date),
    status = CASE
      WHEN ac.status = 'unsubscribed' THEN ac.status
      WHEN ac.status = 'converted' THEN ac.status
      WHEN ac.status = 'left_early'
           AND EXCLUDED.status IN ('reminded', 'expired')
           AND (
             p_set_reminder_sent
             OR COALESCE((b.addons->>'idle_prompt_shown')::boolean, false)
           )
        THEN EXCLUDED.status
      WHEN ac.status = 'left_early' AND EXCLUDED.status IN ('expired', 'reminded', 'open') THEN ac.status
      WHEN EXCLUDED.status = 'left_early' THEN EXCLUDED.status
      ELSE EXCLUDED.status
    END,
    reminder_sent_at = CASE
      WHEN p_set_reminder_sent OR v_status = 'reminded' THEN COALESCE(ac.reminder_sent_at, now())
      ELSE ac.reminder_sent_at
    END,
    expired_at = CASE
      WHEN v_status = 'expired'
           AND ac.status IS DISTINCT FROM 'left_early'
           AND ac.status IS DISTINCT FROM 'converted'
           AND ac.status IS DISTINCT FROM 'unsubscribed'
        THEN COALESCE(ac.expired_at, now())
      ELSE ac.expired_at
    END,
    tags = CASE
      WHEN COALESCE(array_length(ac.tags, 1), 0) = 0 THEN EXCLUDED.tags
      ELSE (
        SELECT ARRAY(
          SELECT DISTINCT t
          FROM unnest(COALESCE(ac.tags, '{}'::text[]) || EXCLUDED.tags) AS t
          WHERE t IS NOT NULL AND length(trim(t)) > 0
          ORDER BY t
        )
      )
    END,
    meta = COALESCE(ac.meta, '{}'::jsonb) || EXCLUDED.meta,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.upsert_abandoned_checkout_from_booking(bigint, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.upsert_abandoned_checkout_from_booking(bigint, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_abandoned_checkout_from_booking(bigint, text, boolean)
  TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 3) create_unfinished_booking_from_pending — don't reuse non-checkout bookings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_unfinished_booking_from_pending(
  p_pending_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  svc record;
  v_plan jsonb;
  v_addons jsonb;
  v_booking_id bigint;
  v_existing_status text;
  v_delivery_type text;
  v_name text;
BEGIN
  IF p_pending_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_id_required');
  END IF;

  SELECT * INTO p
  FROM public.pending_customers
  WHERE id = p_pending_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_not_found');
  END IF;

  IF COALESCE(p.email, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_required');
  END IF;

  IF p.booking_id IS NOT NULL THEN
    SELECT status INTO v_existing_status FROM public.bookings WHERE id = p.booking_id;
    IF FOUND
       AND lower(COALESCE(v_existing_status, '')) IN ('pending_payment', 'booking_not_finished')
    THEN
      RETURN jsonb_build_object(
        'ok', true,
        'booking_id', p.booking_id,
        'already_existed', true,
        'status', v_existing_status
      );
    END IF;

    UPDATE public.pending_customers
    SET booking_id = NULL
    WHERE id = p.id;

    p.booking_id := NULL;
  END IF;

  v_addons := COALESCE(p.addons_data, '{}'::jsonb);
  v_plan := COALESCE(p.plan_data, NULL);

  IF (v_plan IS NULL OR v_plan = '{}'::jsonb) AND p.service_id IS NOT NULL THEN
    SELECT id, name, description, base_price, price_unit, sale_price,
           homepage_description, weekly_rate, daily_rate, features,
           occupancy_model, mileage_rate, delivery_fee
      INTO svc
      FROM public.services
     WHERE id = p.service_id;

    IF FOUND THEN
      v_plan := jsonb_build_object(
        'id', svc.id,
        'name', svc.name,
        'description', svc.description,
        'base_price', svc.base_price,
        'price', COALESCE(p.base_price, svc.base_price),
        'price_unit', svc.price_unit,
        'sale_price', svc.sale_price,
        'homepage_description', svc.homepage_description,
        'weekly_rate', svc.weekly_rate,
        'daily_rate', svc.daily_rate,
        'features', svc.features,
        'occupancy_model', svc.occupancy_model,
        'mileage_rate', svc.mileage_rate,
        'delivery_fee', svc.delivery_fee
      );
    END IF;
  END IF;

  IF v_plan IS NULL THEN
    v_plan := '{}'::jsonb;
  END IF;

  v_delivery_type := CASE
    WHEN COALESCE(p.delivery_service, false)
      OR COALESCE((v_addons->>'isDelivery')::boolean, false)
      OR COALESCE((v_addons->>'deliveryService')::boolean, false)
      THEN 'delivery'
    WHEN COALESCE((v_plan->>'customer_pickup')::boolean, false)
      OR COALESCE((v_plan->>'id')::int, 0) = 2
      THEN 'self_service_trailer'
    ELSE 'self_pickup'
  END;

  v_name := NULLIF(trim(COALESCE(p.name, concat_ws(' ', p.first_name, p.last_name))), '');

  INSERT INTO public.bookings (
    name,
    first_name,
    last_name,
    email,
    phone,
    street,
    city,
    state,
    zip,
    contact_address,
    delivery_address,
    drop_off_date,
    pickup_date,
    drop_off_time_slot,
    pickup_time_slot,
    plan,
    addons,
    total_price,
    subtotal_before_tax,
    tax_amount,
    delivery_type,
    status,
    notes,
    checkout_last_seen_at
  )
  VALUES (
    v_name,
    p.first_name,
    p.last_name,
    lower(trim(p.email)),
    p.phone,
    p.street,
    p.city,
    p.state,
    p.zip,
    p.contact_address,
    p.delivery_address,
    p.drop_off_date,
    p.pickup_date,
    p.drop_off_time_slot,
    p.pickup_time_slot,
    v_plan,
    v_addons || jsonb_build_object('equipment_hold_active', false),
    COALESCE(p.total_price, 0)::real,
    COALESCE(p.subtotal_before_tax, 0),
    0,
    v_delivery_type,
    'booking_not_finished',
    p.notes,
    COALESCE(p.last_seen_at, timezone('utc', now()))
  )
  RETURNING id INTO v_booking_id;

  UPDATE public.pending_customers
  SET booking_id = v_booking_id
  WHERE id = p.id;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'already_existed', false,
    'status', 'booking_not_finished'
  );
END;
$$;

ALTER FUNCTION public.create_unfinished_booking_from_pending(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_unfinished_booking_from_pending(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_unfinished_booking_from_pending(uuid)
  TO service_role, authenticated, anon;
