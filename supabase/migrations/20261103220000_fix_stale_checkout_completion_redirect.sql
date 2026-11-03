-- Repeat customers reuse one pending_customers row per email. After contact
-- (step 4 → 5), the idle guard polls get_checkout_completion_status. Two gaps
-- still marked a brand-new draft as "already paid" and redirected to an old
-- confirmation for every service type:
--
-- 1) store_pending_booking only unlinked a converted booking_id when dates
--    differed — same-date rebooks (or delivery vs pickup on the same days)
--    kept the old link.
-- 2) get_checkout_completion_status also treated any overlapping converted
--    sibling as completion, even when that booking belonged to a prior order.
--
-- Fix: always unlink converted bookings when rewriting the pending draft, and
-- only accept sibling matches created at/after this pending row's created_at
-- (store_pending_booking refreshes created_at on each new attempt).

-- Drop the previous 4-arg overload first so callers cannot keep using the
-- unfixed body after this migration adds p_not_before.
DROP FUNCTION IF EXISTS public.find_converted_checkout_sibling(text, bigint, date, date);

CREATE OR REPLACE FUNCTION public.find_converted_checkout_sibling(
  p_email text,
  p_exclude_booking_id bigint DEFAULT NULL,
  p_drop_off date DEFAULT NULL,
  p_pickup date DEFAULT NULL,
  p_not_before timestamptz DEFAULT NULL
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
     AND (p_not_before IS NULL OR b.created_at >= p_not_before)
     AND (
       (
         v_start IS NOT NULL
         AND b.drop_off_date IS NOT NULL
         AND daterange(
           b.drop_off_date,
           COALESCE(b.pickup_date, b.drop_off_date),
           '[]'
         ) && daterange(v_start, v_end, '[]')
         -- Without an explicit checkout floor, ignore older paid rentals so a
         -- new booking for overlapping dates is not treated as already paid.
         AND (
           p_not_before IS NOT NULL
           OR b.created_at > (timezone('utc', now()) - interval '24 hours')
         )
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

COMMENT ON FUNCTION public.find_converted_checkout_sibling(text, bigint, date, date, timestamptz) IS
  'Find a paid/active booking for the same email/dates. Optional p_not_before limits matches to bookings created for the current checkout attempt.';

GRANT EXECUTE ON FUNCTION public.find_converted_checkout_sibling(text, bigint, date, date, timestamptz)
  TO anon, authenticated, service_role;

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
  v_email text;
  v_verified boolean;
  v_progress jsonb;
BEGIN
  IF p_pending_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_id_required');
  END IF;

  SELECT id, email, booking_id, drop_off_date, pickup_date, is_verified, verified_at, created_at
    INTO p
    FROM public.pending_customers
   WHERE id = p_pending_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_not_found', 'completed', false);
  END IF;

  v_email := lower(trim(COALESCE(p.email, '')));
  v_verified := COALESCE(p.is_verified, false);

  v_progress := jsonb_build_object(
    'email', v_email,
    'email_verified', v_verified,
    'verified_at', p.verified_at
  );

  IF p.booking_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.bookings WHERE id = p.booking_id;
    IF FOUND AND public.booking_status_is_converted(v_status) THEN
      RETURN v_progress || jsonb_build_object(
        'ok', true,
        'completed', true,
        'booking_id', p.booking_id,
        'status', v_status,
        'reason', 'linked_booking'
      );
    END IF;
  END IF;

  -- Only treat overlapping paid bookings as "this checkout finished elsewhere"
  -- when they were created at/after this pending draft was last rewritten.
  v_converted_id := public.find_converted_checkout_sibling(
    p.email,
    p.booking_id,
    p.drop_off_date,
    p.pickup_date,
    p.created_at
  );

  IF v_converted_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.bookings WHERE id = v_converted_id;
    RETURN v_progress || jsonb_build_object(
      'ok', true,
      'completed', true,
      'booking_id', v_converted_id,
      'status', v_status,
      'reason', 'sibling_converted'
    );
  END IF;

  RETURN v_progress || jsonb_build_object(
    'ok', true,
    'completed', false,
    'booking_id', p.booking_id,
    'status', v_status
  );
END;
$$;

COMMENT ON FUNCTION public.get_checkout_completion_status(uuid) IS
  'Checkout progress for a pending id. Sibling "already converted" matches must be created at/after the pending draft, so prior orders never redirect a new booking.';

GRANT EXECUTE ON FUNCTION public.get_checkout_completion_status(uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.store_pending_booking(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        -- Previous hold was released or cancelled: start clean.
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
        -- Any prior paid/active booking on this reused row belongs to an older
        -- order. Always start the new draft unlinked; dual-tab completion is
        -- detected via booking_id re-link or a sibling created after created_at.
        WHEN booking_id IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM public.bookings b
               WHERE b.id = booking_id
                 AND public.booking_status_is_converted(b.status)
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
$function$;

GRANT EXECUTE ON FUNCTION public.store_pending_booking(jsonb)
  TO anon, authenticated, service_role;

-- Repair drafts that still point at a prior paid order.
UPDATE public.pending_customers pc
SET booking_id = NULL
FROM public.bookings b
WHERE pc.booking_id = b.id
  AND public.booking_status_is_converted(b.status);
