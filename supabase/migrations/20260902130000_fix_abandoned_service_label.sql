-- Fix Did Not Finalize service labels:
-- promote-from-pending was writing JSON-null plans, so CRM fell back to "Service" / other-service.

-- ---------------------------------------------------------------------------
-- 1) create_unfinished_booking_from_pending — treat JSON null as missing plan
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
  v_existing_plan jsonb;
  v_delivery_type text;
  v_name text;
  v_service_name text;
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

  v_addons := CASE
    WHEN p.addons_data IS NULL THEN '{}'::jsonb
    WHEN jsonb_typeof(p.addons_data) = 'null' THEN '{}'::jsonb
    ELSE p.addons_data
  END;

  v_plan := CASE
    WHEN p.plan_data IS NULL THEN NULL
    WHEN jsonb_typeof(p.plan_data) = 'null' THEN NULL
    WHEN p.plan_data = '{}'::jsonb THEN NULL
    WHEN NULLIF(trim(COALESCE(p.plan_data->>'name', '')), '') IS NULL
         AND NULLIF(trim(COALESCE(p.plan_data->>'id', '')), '') IS NULL
      THEN NULL
    ELSE p.plan_data
  END;

  IF v_plan IS NULL AND p.service_id IS NOT NULL THEN
    SELECT id, name, description, base_price, price_unit, sale_price,
           homepage_description, weekly_rate, daily_rate, features,
           occupancy_model, mileage_rate, delivery_fee, customer_pickup
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
        'delivery_fee', svc.delivery_fee,
        'customer_pickup', svc.customer_pickup
      );
    END IF;
  END IF;

  IF v_plan IS NULL THEN
    v_plan := '{}'::jsonb;
  ELSIF NULLIF(trim(COALESCE(v_plan->>'name', '')), '') IS NULL
        AND p.service_id IS NOT NULL THEN
    SELECT name INTO v_service_name FROM public.services WHERE id = p.service_id;
    IF v_service_name IS NOT NULL THEN
      v_plan := v_plan || jsonb_build_object('id', p.service_id, 'name', v_service_name);
    END IF;
  END IF;

  -- If already linked to a checkout booking, reuse it (and repair missing plan).
  IF p.booking_id IS NOT NULL THEN
    SELECT status, plan
      INTO v_existing_status, v_existing_plan
      FROM public.bookings
     WHERE id = p.booking_id;

    IF FOUND
       AND lower(COALESCE(v_existing_status, '')) IN ('pending_payment', 'booking_not_finished')
    THEN
      IF (
           v_existing_plan IS NULL
           OR jsonb_typeof(v_existing_plan) = 'null'
           OR v_existing_plan = '{}'::jsonb
           OR NULLIF(trim(COALESCE(v_existing_plan->>'name', '')), '') IS NULL
         )
         AND v_plan IS NOT NULL
         AND v_plan <> '{}'::jsonb
      THEN
        UPDATE public.bookings
        SET plan = v_plan
        WHERE id = p.booking_id;
      END IF;

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

-- ---------------------------------------------------------------------------
-- 2) upsert_abandoned_checkout_from_booking — resolve real service name
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
  v_plan jsonb;
  v_plan_id int;
  v_pending_service_id int;
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

  v_plan := CASE
    WHEN b.plan IS NULL THEN NULL
    WHEN jsonb_typeof(b.plan) = 'null' THEN NULL
    WHEN b.plan = '{}'::jsonb THEN NULL
    ELSE b.plan
  END;

  v_plan_id := NULLIF(COALESCE(v_plan->>'id', ''), '')::int;

  SELECT pc.service_id
    INTO v_pending_service_id
    FROM public.pending_customers pc
   WHERE pc.booking_id = b.id
   ORDER BY pc.created_at DESC NULLS LAST, pc.id DESC
   LIMIT 1;

  IF v_plan_id IS NULL THEN
    v_plan_id := v_pending_service_id;
  END IF;

  v_service_name := NULLIF(trim(COALESCE(v_plan->>'name', '')), '');

  IF v_service_name IS NULL AND v_plan_id IS NOT NULL THEN
    SELECT name INTO v_service_name FROM public.services WHERE id = v_plan_id;
  END IF;

  IF v_service_name IS NULL AND v_pending_service_id IS NOT NULL THEN
    SELECT name INTO v_service_name FROM public.services WHERE id = v_pending_service_id;
  END IF;

  v_service_name := COALESCE(NULLIF(trim(v_service_name), ''), 'Service');

  IF v_plan IS NULL THEN
    v_plan := '{}'::jsonb;
  END IF;

  IF v_plan_id IS NOT NULL AND NULLIF(v_plan->>'id', '') IS NULL THEN
    v_plan := v_plan || jsonb_build_object('id', v_plan_id);
  END IF;

  IF NULLIF(trim(COALESCE(v_plan->>'name', '')), '') IS NULL
     AND v_service_name IS DISTINCT FROM 'Service' THEN
    v_plan := v_plan || jsonb_build_object('name', v_service_name);
  END IF;

  v_tags := public.abandoned_checkout_service_tags(v_service_name, v_plan, b.addons);

  v_cart := jsonb_build_object(
    'booking_id', b.id,
    'plan', v_plan,
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
    v_plan,
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
    service_name = CASE
      WHEN EXCLUDED.service_name IS DISTINCT FROM 'Service' THEN EXCLUDED.service_name
      WHEN COALESCE(ac.service_name, '') IN ('', 'Service') THEN EXCLUDED.service_name
      ELSE COALESCE(ac.service_name, EXCLUDED.service_name)
    END,
    plan = CASE
      WHEN EXCLUDED.plan IS NOT NULL
           AND jsonb_typeof(EXCLUDED.plan) <> 'null'
           AND EXCLUDED.plan <> '{}'::jsonb
           AND NULLIF(trim(COALESCE(EXCLUDED.plan->>'name', '')), '') IS NOT NULL
        THEN EXCLUDED.plan
      ELSE COALESCE(ac.plan, EXCLUDED.plan)
    END,
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
      WHEN EXCLUDED.tags IS NOT NULL
           AND NOT (EXCLUDED.tags = ARRAY['other-service']::text[])
        THEN EXCLUDED.tags
      WHEN COALESCE(array_length(ac.tags, 1), 0) = 0 THEN EXCLUDED.tags
      WHEN ac.tags = ARRAY['other-service']::text[] THEN EXCLUDED.tags
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
-- 3) Backfill bookings.plan + abandoned_checkouts labels
-- ---------------------------------------------------------------------------
UPDATE public.bookings b
SET plan = jsonb_build_object(
  'id', s.id,
  'name', s.name,
  'description', s.description,
  'base_price', s.base_price,
  'price', COALESCE(pc.base_price, s.base_price),
  'price_unit', s.price_unit,
  'sale_price', s.sale_price,
  'homepage_description', s.homepage_description,
  'weekly_rate', s.weekly_rate,
  'daily_rate', s.daily_rate,
  'features', s.features,
  'occupancy_model', s.occupancy_model,
  'mileage_rate', s.mileage_rate,
  'delivery_fee', s.delivery_fee,
  'customer_pickup', s.customer_pickup
)
FROM public.pending_customers pc
JOIN public.services s ON s.id = pc.service_id
WHERE pc.booking_id = b.id
  AND pc.service_id IS NOT NULL
  AND lower(COALESCE(b.status, '')) IN ('pending_payment', 'booking_not_finished')
  AND (
    b.plan IS NULL
    OR jsonb_typeof(b.plan) = 'null'
    OR b.plan = '{}'::jsonb
    OR NULLIF(trim(COALESCE(b.plan->>'name', '')), '') IS NULL
  );

UPDATE public.abandoned_checkouts ac
SET
  service_name = resolved.service_name,
  plan = resolved.plan,
  tags = public.abandoned_checkout_service_tags(resolved.service_name, resolved.plan, ac.addons),
  cart_snapshot = COALESCE(ac.cart_snapshot, '{}'::jsonb)
    || jsonb_build_object('plan', resolved.plan),
  updated_at = now()
FROM (
  SELECT
    ac2.id AS abandoned_id,
    COALESCE(
      NULLIF(trim(COALESCE(b.plan->>'name', '')), ''),
      NULLIF(trim(s_from_plan.name), ''),
      NULLIF(trim(s_from_pending.name), ''),
      NULLIF(trim(ac2.service_name), ''),
      'Service'
    ) AS service_name,
    CASE
      WHEN b.plan IS NOT NULL
           AND jsonb_typeof(b.plan) <> 'null'
           AND b.plan <> '{}'::jsonb
           AND NULLIF(trim(COALESCE(b.plan->>'name', '')), '') IS NOT NULL
        THEN b.plan
      WHEN s_from_pending.id IS NOT NULL THEN jsonb_build_object(
        'id', s_from_pending.id,
        'name', s_from_pending.name
      )
      WHEN s_from_plan.id IS NOT NULL THEN jsonb_build_object(
        'id', s_from_plan.id,
        'name', s_from_plan.name
      )
      WHEN ac2.plan IS NOT NULL
           AND jsonb_typeof(ac2.plan) <> 'null'
           AND ac2.plan <> '{}'::jsonb
        THEN ac2.plan
      ELSE '{}'::jsonb
    END AS plan
  FROM public.abandoned_checkouts ac2
  LEFT JOIN public.bookings b ON b.id = ac2.booking_id
  LEFT JOIN public.services s_from_plan
    ON s_from_plan.id = NULLIF(COALESCE(b.plan->>'id', ac2.plan->>'id'), '')::int
  LEFT JOIN LATERAL (
    SELECT pc.service_id
    FROM public.pending_customers pc
    WHERE pc.booking_id = ac2.booking_id
    ORDER BY pc.created_at DESC NULLS LAST, pc.id DESC
    LIMIT 1
  ) pc ON true
  LEFT JOIN public.services s_from_pending ON s_from_pending.id = pc.service_id
  WHERE COALESCE(ac2.service_name, '') IN ('', 'Service')
     OR ac2.tags = ARRAY['other-service']::text[]
     OR ac2.plan IS NULL
     OR jsonb_typeof(ac2.plan) = 'null'
     OR NULLIF(trim(COALESCE(ac2.plan->>'name', '')), '') IS NULL
) resolved
WHERE ac.id = resolved.abandoned_id;
