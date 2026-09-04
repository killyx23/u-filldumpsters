-- A repeat customer reuses their pending_customers row (unique per unverified
-- email). store_pending_booking only dropped the linked booking_id when that
-- booking was cancelled/unfinished, so a *converted* booking stayed attached to
-- the next, unrelated checkout. Everything downstream then reads
-- get_checkout_completion_status -> completed:true and jumps the customer to the
-- old confirmation without taking payment.
--
-- Fix: also drop the link when the attached converted booking is for different
-- dates than the checkout now being saved. Same dates still keep the link, which
-- is the genuine "converted in another tab" case the link exists for.

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
        -- Repeat customer: this row is being reused for different dates, so the
        -- converted booking attached to it belongs to their previous order.
        WHEN booking_id IS NOT NULL
             AND v_drop_off_date IS NOT NULL
             AND EXISTS (
               SELECT 1
               FROM public.bookings b
               WHERE b.id = booking_id
                 AND public.booking_status_is_converted(b.status)
                 AND (
                   b.drop_off_date IS DISTINCT FROM v_drop_off_date
                   OR COALESCE(b.pickup_date, b.drop_off_date)
                      IS DISTINCT FROM COALESCE(v_pickup_date, v_drop_off_date)
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
$function$;

GRANT EXECUTE ON FUNCTION public.store_pending_booking(jsonb)
  TO anon, authenticated, service_role;

-- Repair rows already carrying a stale link to a converted booking for other dates.
UPDATE public.pending_customers pc
SET booking_id = NULL
FROM public.bookings b
WHERE pc.booking_id = b.id
  AND pc.drop_off_date IS NOT NULL
  AND public.booking_status_is_converted(b.status)
  AND (
    b.drop_off_date IS DISTINCT FROM pc.drop_off_date
    OR COALESCE(b.pickup_date, b.drop_off_date)
       IS DISTINCT FROM COALESCE(pc.pickup_date, pc.drop_off_date)
  );
