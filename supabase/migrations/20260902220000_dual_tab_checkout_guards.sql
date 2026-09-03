-- Dual-tab email-verify: link pending → booking, reuse one payment hold,
-- skip false abandon email / unsafe restock when checkout already converted.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_status_is_converted(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(lower(p_status), '') IN (
    'confirmed',
    'rescheduled',
    'delivered',
    'waiting_to_be_returned',
    'pending_review',
    'pending',
    'flagged'
  );
$$;

COMMENT ON FUNCTION public.booking_status_is_converted(text) IS
  'True when a booking is a real paid/active rental (not pending_payment or booking_not_finished).';

CREATE OR REPLACE FUNCTION public.find_converted_checkout_sibling(
  p_email text,
  p_exclude_booking_id bigint DEFAULT NULL,
  p_drop_off date DEFAULT NULL,
  p_pickup date DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_id bigint;
  v_start date;
  v_end date;
BEGIN
  v_email := lower(trim(COALESCE(p_email, '')));
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  v_start := p_drop_off;
  v_end := COALESCE(p_pickup, p_drop_off);

  SELECT b.id
    INTO v_id
    FROM public.bookings b
   WHERE lower(trim(COALESCE(b.email, ''))) = v_email
     AND (p_exclude_booking_id IS NULL OR b.id IS DISTINCT FROM p_exclude_booking_id)
     AND public.booking_status_is_converted(b.status)
     AND (
       (
         v_start IS NOT NULL
         AND b.drop_off_date IS NOT NULL
         AND daterange(
           b.drop_off_date,
           COALESCE(b.pickup_date, b.drop_off_date),
           '[]'
         ) && daterange(v_start, v_end, '[]')
       )
       OR (
         v_start IS NULL
         AND b.created_at > (timezone('utc', now()) - interval '24 hours')
       )
     )
   ORDER BY b.id DESC
   LIMIT 1;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_checkout_completion_status(p_pending_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  v_status text;
  v_converted_id bigint;
BEGIN
  IF p_pending_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_id_required');
  END IF;

  SELECT id, email, booking_id, drop_off_date, pickup_date
    INTO p
    FROM public.pending_customers
   WHERE id = p_pending_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_not_found', 'completed', false);
  END IF;

  IF p.booking_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.bookings WHERE id = p.booking_id;
    IF FOUND AND public.booking_status_is_converted(v_status) THEN
      RETURN jsonb_build_object(
        'ok', true,
        'completed', true,
        'booking_id', p.booking_id,
        'status', v_status,
        'reason', 'linked_booking'
      );
    END IF;
  END IF;

  v_converted_id := public.find_converted_checkout_sibling(
    p.email,
    p.booking_id,
    p.drop_off_date,
    p.pickup_date
  );

  IF v_converted_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.bookings WHERE id = v_converted_id;
    RETURN jsonb_build_object(
      'ok', true,
      'completed', true,
      'booking_id', v_converted_id,
      'status', v_status,
      'reason', 'sibling_converted'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'completed', false,
    'booking_id', p.booking_id,
    'status', v_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.booking_status_is_converted(text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_converted_checkout_sibling(text, bigint, date, date)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_checkout_completion_status(uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_pending_booking — link pending UUID, reuse one open hold
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pending_booking(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_id bigint;
  new_customer_id bigint;
  v_pending_id uuid;
  p record;
  b record;
  v_sibling bigint;
  v_hold_active boolean;
  v_drop_off date;
  v_pickup date;
  v_email text;
BEGIN
  BEGIN
    v_pending_id := NULLIF(trim(COALESCE(
      payload->>'pending_customer_id',
      payload->>'pending_id',
      ''
    )), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_pending_id := NULL;
  END;

  BEGIN
    v_drop_off := (payload->>'drop_off_date')::date;
  EXCEPTION WHEN others THEN
    v_drop_off := NULL;
  END;
  BEGIN
    v_pickup := (payload->>'pickup_date')::date;
  EXCEPTION WHEN others THEN
    v_pickup := NULL;
  END;

  v_email := lower(trim(COALESCE(payload->>'email', '')));

  IF v_pending_id IS NOT NULL THEN
    SELECT * INTO p
    FROM public.pending_customers
    WHERE id = v_pending_id
    FOR UPDATE;

    IF FOUND THEN
      v_email := lower(trim(COALESCE(NULLIF(p.email, ''), v_email)));
      v_drop_off := COALESCE(p.drop_off_date, v_drop_off);
      v_pickup := COALESCE(p.pickup_date, v_pickup);

      IF p.booking_id IS NOT NULL THEN
        SELECT * INTO b
        FROM public.bookings
        WHERE id = p.booking_id
        FOR UPDATE;

        IF FOUND AND lower(COALESCE(b.status, '')) = 'pending_payment' THEN
          v_hold_active := COALESCE(b.addons->>'equipment_hold_active', '') = 'true';
          RETURN jsonb_build_object(
            'id', b.id,
            'customer_id', b.customer_id,
            'reused', true,
            'already_converted', false,
            'equipment_hold_active', v_hold_active,
            'status', b.status
          );
        END IF;

        IF FOUND AND public.booking_status_is_converted(b.status) THEN
          RETURN jsonb_build_object(
            'id', b.id,
            'customer_id', b.customer_id,
            'reused', false,
            'already_converted', true,
            'equipment_hold_active', false,
            'status', b.status
          );
        END IF;

        UPDATE public.pending_customers
        SET booking_id = NULL
        WHERE id = p.id;
        p.booking_id := NULL;
      END IF;

      v_sibling := public.find_converted_checkout_sibling(
        COALESCE(NULLIF(v_email, ''), p.email),
        NULL,
        v_drop_off,
        v_pickup
      );
      IF v_sibling IS NOT NULL THEN
        UPDATE public.pending_customers
        SET booking_id = v_sibling
        WHERE id = p.id
          AND booking_id IS NULL;

        SELECT id, customer_id, status
          INTO b
          FROM public.bookings
         WHERE id = v_sibling;

        RETURN jsonb_build_object(
          'id', v_sibling,
          'customer_id', b.customer_id,
          'reused', false,
          'already_converted', true,
          'equipment_hold_active', false,
          'status', b.status
        );
      END IF;
    END IF;
  ELSIF v_email <> '' THEN
    v_sibling := public.find_converted_checkout_sibling(v_email, NULL, v_drop_off, v_pickup);
    IF v_sibling IS NOT NULL THEN
      SELECT id, customer_id, status INTO b FROM public.bookings WHERE id = v_sibling;
      RETURN jsonb_build_object(
        'id', v_sibling,
        'customer_id', b.customer_id,
        'reused', false,
        'already_converted', true,
        'equipment_hold_active', false,
        'status', b.status
      );
    END IF;
  END IF;

  INSERT INTO bookings (
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
    tax_rate_used,
    delivery_type,
    status,
    notes,
    was_verification_skipped,
    verification_notes
  )
  VALUES (
    payload->>'name',
    payload->>'first_name',
    payload->>'last_name',
    payload->>'email',
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
    payload->'plan',
    payload->'addons',
    (payload->>'total_price')::real,
    COALESCE((payload->>'subtotal_before_tax')::numeric, 0),
    COALESCE((payload->>'tax_amount')::numeric, 0),
    COALESCE((payload->>'tax_rate_used')::numeric, 0),
    payload->>'delivery_type',
    'pending_payment',
    payload->>'notes',
    COALESCE((payload->>'was_verification_skipped')::boolean, false),
    payload->>'verification_notes'
  )
  RETURNING id, customer_id INTO new_id, new_customer_id;

  IF v_pending_id IS NOT NULL THEN
    UPDATE public.pending_customers
    SET booking_id = new_id
    WHERE id = v_pending_id;
  END IF;

  IF jsonb_typeof(payload->'addons'->'agreementFeeSnapshot') = 'array' THEN
    INSERT INTO public.booking_fee_snapshots (
      booking_id,
      fee_key,
      fee_name,
      fee_description,
      fee_value,
      is_percentage,
      snapshot_source,
      captured_at
    )
    SELECT
      new_id,
      COALESCE(item->>'fee_key', 'unknown_fee_key'),
      COALESCE(item->>'fee_name', item->>'fee_key', 'Unknown Fee'),
      item->>'fee_description',
      COALESCE(NULLIF(item->>'fee_value', '')::numeric, 0),
      COALESCE((item->>'is_percentage')::boolean, false),
      COALESCE(item->>'source', 'agreement_step6_acceptance'),
      COALESCE((item->>'captured_at')::timestamptz, NOW())
    FROM jsonb_array_elements(payload->'addons'->'agreementFeeSnapshot') AS item;
  END IF;

  RETURN jsonb_build_object(
    'id', new_id,
    'customer_id', new_customer_id,
    'reused', false,
    'already_converted', false,
    'equipment_hold_active', false,
    'status', 'pending_payment'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pending_booking(jsonb)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_unfinished_booking_from_pending — do not invent a second booking
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
  v_sibling bigint;
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

  IF p.booking_id IS NOT NULL THEN
    SELECT status, plan
      INTO v_existing_status, v_existing_plan
      FROM public.bookings
     WHERE id = p.booking_id;

    IF FOUND AND public.booking_status_is_converted(v_existing_status) THEN
      RETURN jsonb_build_object(
        'ok', true,
        'skipped', true,
        'reason', 'already_converted',
        'booking_id', p.booking_id,
        'converted_booking_id', p.booking_id,
        'already_existed', true,
        'status', v_existing_status
      );
    END IF;

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

  v_sibling := public.find_converted_checkout_sibling(
    p.email,
    NULL,
    p.drop_off_date,
    p.pickup_date
  );

  IF v_sibling IS NOT NULL THEN
    UPDATE public.pending_customers
    SET booking_id = v_sibling
    WHERE id = p.id;

    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_converted',
      'booking_id', v_sibling,
      'converted_booking_id', v_sibling,
      'already_existed', true,
      'status', 'converted'
    );
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
-- finalize_unfinished_checkout — never restock / email when sibling paid
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_unfinished_checkout(
  p_booking_id bigint,
  p_reason text DEFAULT 'left_early'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  eq jsonb;
  items jsonb := '[]'::jsonb;
  eq_id bigint;
  qty int;
  should_restock boolean := false;
  did_restock boolean := false;
  v_reason text;
  v_crm_id bigint;
  v_notes text;
  already_done boolean := false;
  v_sibling bigint;
  v_crm_status text;
BEGIN
  v_reason := lower(COALESCE(NULLIF(trim(p_reason), ''), 'left_early'));
  IF v_reason NOT IN ('left_early', 'reminded', 'expired', 'converted') THEN
    v_reason := 'left_early';
  END IF;

  SELECT id, status, addons, created_at, total_price, email, drop_off_date, pickup_date
    INTO rec
    FROM public.bookings
   WHERE id = p_booking_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found');
  END IF;

  IF public.booking_status_is_converted(rec.status) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'skip_email', true,
      'skipped_reason', 'already_converted',
      'booking_id', rec.id,
      'converted_booking_id', rec.id,
      'restocked', false
    );
  END IF;

  v_sibling := public.find_converted_checkout_sibling(
    rec.email,
    rec.id,
    rec.drop_off_date,
    rec.pickup_date
  );

  IF lower(COALESCE(rec.status, '')) = 'booking_not_finished' THEN
    already_done := true;
    v_crm_status := CASE WHEN v_sibling IS NOT NULL THEN 'converted' ELSE v_reason END;
    v_crm_id := public.upsert_abandoned_checkout_from_booking(
      rec.id,
      v_crm_status,
      v_reason = 'reminded' AND v_sibling IS NULL
    );
    RETURN jsonb_build_object(
      'ok', true,
      'already_finalized', true,
      'booking_id', rec.id,
      'reason', v_crm_status,
      'restocked', false,
      'skip_email', v_sibling IS NOT NULL,
      'skipped_reason', CASE WHEN v_sibling IS NOT NULL THEN 'already_converted' ELSE NULL END,
      'converted_booking_id', v_sibling,
      'abandoned_checkout_id', v_crm_id
    );
  END IF;

  IF lower(COALESCE(rec.status, '')) IS DISTINCT FROM 'pending_payment' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_pending_payment',
      'status', rec.status,
      'skip_email', true
    );
  END IF;

  -- Restock only when this hold is unique — never when a paid sibling owns the dates.
  IF v_sibling IS NULL
     AND rec.addons IS NOT NULL
     AND jsonb_typeof(rec.addons->'equipment') = 'array'
     AND jsonb_array_length(rec.addons->'equipment') > 0
  THEN
    IF COALESCE(rec.addons->>'equipment_hold_active', '') IS DISTINCT FROM 'false' THEN
      should_restock := true;
    END IF;

    IF should_restock THEN
      FOR eq IN SELECT * FROM jsonb_array_elements(rec.addons->'equipment')
      LOOP
        eq_id := NULLIF(COALESCE(eq->>'dbId', eq->>'equipment_id', eq->>'id'), '')::bigint;
        qty := COALESCE(NULLIF(eq->>'quantity', '')::int, 1);
        IF eq_id IS NOT NULL AND qty > 0 THEN
          items := items || jsonb_build_array(
            jsonb_build_object('equipment_id', eq_id, 'quantity', qty)
          );
        END IF;
      END LOOP;

      IF jsonb_array_length(items) > 0 THEN
        PERFORM public.increment_equipment_quantities(items);
        did_restock := true;
      END IF;
    END IF;
  END IF;

  v_notes := CASE
    WHEN v_sibling IS NOT NULL THEN 'Superseded by paid booking in another tab'
    WHEN v_reason = 'reminded' THEN 'Idle checkout — reminded (no response to still-here prompt)'
    WHEN v_reason = 'expired' THEN 'Idle checkout — expired (30 minute ceiling)'
    ELSE 'Customer left booking before payment completed'
  END;

  UPDATE public.bookings
  SET
    status = 'booking_not_finished',
    addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('equipment_hold_active', false),
    archive_details = jsonb_build_object(
      'action', 'booking_not_finished',
      'action_at', now(),
      'initiated_by', CASE WHEN v_reason = 'left_early' AND v_sibling IS NULL THEN 'customer' ELSE 'system' END,
      'notes', v_notes,
      'reason', CASE WHEN v_sibling IS NOT NULL THEN 'converted' ELSE v_reason END,
      'original_created_at', rec.created_at,
      'original_total_price', rec.total_price,
      'converted_booking_id', v_sibling
    )
  WHERE id = rec.id
    AND status = 'pending_payment';

  IF NOT FOUND AND NOT already_done THEN
    RETURN jsonb_build_object('ok', false, 'error', 'status_race');
  END IF;

  v_crm_status := CASE WHEN v_sibling IS NOT NULL THEN 'converted' ELSE v_reason END;
  v_crm_id := public.upsert_abandoned_checkout_from_booking(
    rec.id,
    v_crm_status,
    v_reason = 'reminded' AND v_sibling IS NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', rec.id,
    'reason', v_crm_status,
    'restocked', did_restock,
    'skip_email', v_sibling IS NOT NULL,
    'skipped_reason', CASE WHEN v_sibling IS NOT NULL THEN 'already_converted' ELSE NULL END,
    'converted_booking_id', v_sibling,
    'abandoned_checkout_id', v_crm_id
  );
END;
$$;

ALTER FUNCTION public.finalize_unfinished_checkout(bigint, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_unfinished_checkout(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_unfinished_checkout(bigint, text)
  TO service_role, authenticated, anon;

-- ---------------------------------------------------------------------------
-- Sweep: skip pending drafts that already converted in another tab
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_stale_unfinished_checkouts(
  p_stale_after interval DEFAULT interval '31 minutes'
)
RETURNS TABLE (
  booking_id bigint,
  pending_id uuid,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id AS booking_id,
    NULL::uuid AS pending_id,
    'booking'::text AS source
  FROM public.bookings b
  WHERE b.status = 'pending_payment'
    AND COALESCE(b.checkout_last_seen_at, b.created_at) < now() - p_stale_after
  ORDER BY b.id;

  RETURN QUERY
  SELECT
    NULL::bigint AS booking_id,
    pc.id AS pending_id,
    'pending'::text AS source
  FROM public.pending_customers pc
  WHERE pc.booking_id IS NULL
    AND COALESCE(pc.last_seen_at, pc.created_at) < now() - p_stale_after
    AND COALESCE(pc.email, '') <> ''
    AND public.find_converted_checkout_sibling(
      pc.email,
      NULL,
      pc.drop_off_date,
      pc.pickup_date
    ) IS NULL
  ORDER BY pc.created_at;
END;
$$;

ALTER FUNCTION public.find_stale_unfinished_checkouts(interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.find_stale_unfinished_checkouts(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_stale_unfinished_checkouts(interval) TO service_role;
