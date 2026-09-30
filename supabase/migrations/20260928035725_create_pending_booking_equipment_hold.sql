-- Hold rental equipment stock inside create_pending_booking so a failed
-- decrement rolls back the pending booking instead of leaving an orphan hold.

CREATE OR REPLACE FUNCTION public.take_equipment_hold_from_addons(
  p_booking_id bigint,
  p_addons jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_equipment jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_equipment_id bigint;
  v_quantity int;
  v_current_addons jsonb;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT addons INTO v_current_addons
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF COALESCE(v_current_addons->>'equipment_hold_active', '') = 'true' THEN
    RETURN true;
  END IF;

  v_equipment := COALESCE(p_addons->'equipment', v_current_addons->'equipment', '[]'::jsonb);
  IF jsonb_typeof(v_equipment) <> 'array' OR jsonb_array_length(v_equipment) = 0 THEN
    RETURN false;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_equipment)
  LOOP
    BEGIN
      v_equipment_id := COALESCE(
        NULLIF(v_item->>'dbId', '')::bigint,
        NULLIF(v_item->>'equipment_id', '')::bigint,
        NULLIF(v_item->>'id', '')::bigint
      );
    EXCEPTION WHEN others THEN
      v_equipment_id := NULL;
    END;

    BEGIN
      v_quantity := COALESCE(NULLIF(v_item->>'quantity', '')::int, 1);
    EXCEPTION WHEN others THEN
      v_quantity := 0;
    END;

    IF v_equipment_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      CONTINUE;
    END IF;

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'equipment_id', v_equipment_id,
        'quantity', v_quantity
      )
    );
  END LOOP;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN false;
  END IF;

  PERFORM public.decrement_equipment_quantities(v_items);

  UPDATE public.bookings
  SET addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('equipment_hold_active', true)
  WHERE id = p_booking_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.take_equipment_hold_from_addons(bigint, jsonb)
  TO anon, authenticated, service_role;

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
          IF NOT v_hold_active THEN
            v_hold_active := public.take_equipment_hold_from_addons(
              b.id,
              COALESCE(payload->'addons', b.addons)
            );
          END IF;
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

  v_hold_active := public.take_equipment_hold_from_addons(new_id, payload->'addons');

  RETURN jsonb_build_object(
    'id', new_id,
    'customer_id', new_customer_id,
    'reused', false,
    'already_converted', false,
    'equipment_hold_active', v_hold_active,
    'status', 'pending_payment'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pending_booking(jsonb)
  TO anon, authenticated, service_role;
