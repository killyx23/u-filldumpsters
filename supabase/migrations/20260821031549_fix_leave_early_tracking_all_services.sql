-- Fix leave-early / abandoned-checkout tracking for ALL services:
-- 1) Do not mark every unpaid checkout customer as feedback_lead on create
-- 2) Protect left_early leads from being overwritten to expired/reminded
-- 3) Auto-tag abandoned_checkouts by service
-- 4) Raise pg_net timeout for the reminder cron so emails actually send

-- ---------------------------------------------------------------------------
-- New customers: stay 'booked' until leave-early / survey promotes them
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_booking() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  customer_id_var bigint;
  unverified_address_flag boolean;
  verification_skipped_flag boolean;
  address_verification_skipped_flag boolean;
  cleaned_phone text;
BEGIN
  cleaned_phone := regexp_replace(NEW.phone, '\D', '', 'g');

  SELECT id INTO customer_id_var FROM public.customers WHERE email = NEW.email;

  unverified_address_flag := COALESCE((NEW.addons->>'unverifiedAddress')::boolean, FALSE);
  verification_skipped_flag := COALESCE(
    (NEW.addons->>'verificationSkipped')::boolean,
    (NEW.addons->>'wasVerificationSkipped')::boolean,
    FALSE
  );
  address_verification_skipped_flag := COALESCE((NEW.addons->>'addressVerificationSkipped')::boolean, FALSE);

  NEW.pending_address_verification := COALESCE((NEW.addons->>'pending_address_verification')::boolean, FALSE);
  IF NEW.pending_address_verification THEN
     NEW.unverified_address := NEW.addons->>'unverified_address';
     NEW.pending_verification_reason := NEW.addons->>'pending_verification_reason';
     NEW.pending_verification_date := now();
  END IF;

  IF customer_id_var IS NOT NULL THEN
    UPDATE public.customers
    SET
      name = COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name, customers.name),
      first_name = COALESCE(NEW.first_name, customers.first_name),
      last_name = COALESCE(NEW.last_name, customers.last_name),
      phone = COALESCE(cleaned_phone, customers.phone),
      street = COALESCE(NEW.street, customers.street),
      city = COALESCE(NEW.city, customers.city),
      state = COALESCE(NEW.state, customers.state),
      zip = COALESCE(NEW.zip, customers.zip),
      unverified_address = customers.unverified_address OR unverified_address_flag,
      has_incomplete_verification = customers.has_incomplete_verification OR verification_skipped_flag
    WHERE id = customer_id_var;
  ELSE
    -- Default segment is 'booked'. feedback_lead is set only by leave-early / survey RPCs.
    INSERT INTO public.customers (
      name, first_name, last_name, email, phone, street, city, state, zip,
      unverified_address, has_incomplete_verification, segment
    )
    VALUES (
      COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name),
      NEW.first_name, NEW.last_name, NEW.email, cleaned_phone, NEW.street, NEW.city, NEW.state, NEW.zip,
      unverified_address_flag, verification_skipped_flag, 'booked'
    )
    RETURNING id INTO customer_id_var;
  END IF;

  NEW.customer_id := customer_id_var;
  NEW.was_verification_skipped := verification_skipped_flag OR address_verification_skipped_flag;
  NEW.name := COALESCE(NEW.first_name || ' ' || NEW.last_name, NEW.name);
  NEW.status := 'pending_payment';

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.customers.segment IS
  'booked = default / has paid booking; feedback_lead = left early or submitted how-can-we-do-better feedback';

-- ---------------------------------------------------------------------------
-- Service tags helper for Did Not Finalize filtering
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.abandoned_checkout_service_tags(
  p_service_name text,
  p_plan jsonb,
  p_addons jsonb
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  tags text[] := '{}';
  name_lc text;
  plan_id int;
BEGIN
  name_lc := lower(COALESCE(p_service_name, p_plan->>'name', ''));
  plan_id := NULLIF(p_plan->>'id', '')::int;

  IF plan_id = 2 OR name_lc ~ 'dump.?trailer|dump.?loader|trailer' THEN
    tags := array_append(tags, 'dump-trailer');
  END IF;

    IF plan_id = 1 OR name_lc ~ 'dumpster' THEN
      tags := array_append(tags, 'dumpster');
    END IF;

    IF name_lc ~ 'compact' THEN
      tags := array_append(tags, 'compact-equipment');
    END IF;

  IF name_lc ~ 'rock|mulch|gravel|material' THEN
    tags := array_append(tags, 'materials');
  END IF;

  IF COALESCE((p_addons->>'isDelivery')::boolean, false)
     OR COALESCE((p_addons->>'deliveryService')::boolean, false)
     OR name_lc ~ 'delivery' THEN
    tags := array_append(tags, 'delivery');
  END IF;

  IF COALESCE(array_length(tags, 1), 0) = 0 THEN
    tags := ARRAY['other-service'];
  END IF;

  RETURN tags;
END;
$$;

-- ---------------------------------------------------------------------------
-- Upsert: auto-tags + never overwrite left_early with expired/reminded
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
BEGIN
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
    WHEN p_status = 'left_early' THEN 'left_early'
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
    p_status,
    CASE WHEN p_set_reminder_sent THEN now() ELSE NULL END,
    CASE WHEN p_status = 'expired' THEN now() ELSE NULL END,
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
      -- Intentional leave wins over passive timeout/reminder
      WHEN ac.status = 'left_early' AND EXCLUDED.status IN ('expired', 'reminded', 'open') THEN ac.status
      WHEN EXCLUDED.status = 'left_early' THEN EXCLUDED.status
      ELSE EXCLUDED.status
    END,
    reminder_sent_at = CASE
      WHEN p_set_reminder_sent THEN COALESCE(ac.reminder_sent_at, now())
      ELSE ac.reminder_sent_at
    END,
    expired_at = CASE
      WHEN p_status = 'expired' AND ac.status IS DISTINCT FROM 'left_early' THEN COALESCE(ac.expired_at, now())
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
-- 2h cleanup: still cancel pending_payment, but preserve left_early CRM status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_abandoned_pending_payment_bookings(
  p_older_than interval DEFAULT interval '2 hours'
)
RETURNS TABLE(
  booking_id bigint,
  restocked boolean,
  cancelled boolean
)
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
  should_restock boolean;
  did_restock boolean;
  existing_status text;
BEGIN
  FOR rec IN
    SELECT b.id, b.status, b.addons, b.created_at, b.total_price
    FROM public.bookings b
    WHERE b.status = 'pending_payment'
      AND b.created_at < now() - p_older_than
    ORDER BY b.id
  LOOP
    items := '[]'::jsonb;
    should_restock := false;
    did_restock := false;

    SELECT ac.status INTO existing_status
    FROM public.abandoned_checkouts ac
    WHERE ac.booking_id = rec.id
    LIMIT 1;

    -- Persist CRM lead before cancel, but never demote left_early → expired
    IF existing_status IS DISTINCT FROM 'left_early' THEN
      PERFORM public.upsert_abandoned_checkout_from_booking(rec.id, 'expired', false);
    END IF;

    IF rec.addons IS NOT NULL
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

    UPDATE public.bookings
    SET
      status = 'Cancelled',
      addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('equipment_hold_active', false),
      archive_details = jsonb_build_object(
        'action', 'cancelled',
        'action_at', now(),
        'initiated_by', 'system',
        'notes', 'abandoned_checkout_timeout',
        'original_created_at', rec.created_at,
        'original_total_price', rec.total_price
      )
    WHERE id = rec.id
      AND status = 'pending_payment';

    booking_id := rec.id;
    restocked := did_restock;
    cancelled := FOUND;
    RETURN NEXT;
  END LOOP;
END;
$$;

ALTER FUNCTION public.cleanup_abandoned_pending_payment_bookings(interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cleanup_abandoned_pending_payment_bookings(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_pending_payment_bookings(interval) TO service_role;

-- ---------------------------------------------------------------------------
-- Reminder cron: 60s timeout so Brevo/edge work can finish
-- ---------------------------------------------------------------------------
DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname = 'send-abandoned-checkout-reminder'
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'send-abandoned-checkout-reminder',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/send-abandoned-checkout-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Backfill service tags on existing abandoned_checkouts rows that have none
UPDATE public.abandoned_checkouts ac
SET tags = public.abandoned_checkout_service_tags(ac.service_name, ac.plan, ac.addons)
WHERE COALESCE(array_length(ac.tags, 1), 0) = 0;

-- Demote customers who were only labeled feedback_lead by unpaid checkout create,
-- and never received a leave-early token or submitted feedback.
UPDATE public.customers c
SET segment = 'booked'
WHERE c.segment = 'feedback_lead'
  AND NOT EXISTS (
    SELECT 1 FROM public.feedback_tokens ft WHERE ft.customer_id = c.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.feedback_responses fr WHERE fr.customer_id = c.id
  );
