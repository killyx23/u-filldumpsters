-- Unfinished Booking Teardown
-- - booking_not_finished status (inactive for capacity)
-- - presence heartbeats
-- - finalize_unfinished_checkout + promote from pending
-- - unsubscribe tokens + safe purge
-- - 1-minute sweep cron backstop

-- ---------------------------------------------------------------------------
-- 1) Status helpers: never treat booking_not_finished as capacity-holding
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_status_is_active(p_status text)
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
    'pending_payment',
    'pending',
    'flagged'
  );
$$;

COMMENT ON FUNCTION public.booking_status_is_active(text) IS
  'True when a booking in this status is holding inventory and must count against capacity. '
  'booking_not_finished is intentionally excluded so unfinished checkouts free dates/slots.';

-- ---------------------------------------------------------------------------
-- 2) handle_new_booking: allow booking_not_finished inserts to keep that status
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
  incoming_status text;
BEGIN
  cleaned_phone := regexp_replace(NEW.phone, '\D', '', 'g');
  incoming_status := lower(COALESCE(NEW.status, ''));

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

  -- Preserve booking_not_finished for promote-from-pending path; otherwise unpaid hold.
  IF incoming_status IS DISTINCT FROM 'booking_not_finished' THEN
    NEW.status := 'pending_payment';
  ELSE
    NEW.status := 'booking_not_finished';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Segment helpers: booking_not_finished is not a "real" paid booking
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_customer_segment_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND lower(COALESCE(NEW.status, '')) NOT IN (
       'pending_payment',
       'cancelled',
       'canceled',
       'booking_not_finished'
     )
  THEN
    UPDATE public.customers
    SET segment = 'booked'
    WHERE id = NEW.customer_id
      AND segment IS DISTINCT FROM 'booked';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_customer_feedback_lead(p_customer_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.customer_id = p_customer_id
      AND lower(COALESCE(b.status, '')) NOT IN (
        'pending_payment',
        'cancelled',
        'canceled',
        'booking_not_finished'
      )
  ) THEN
    UPDATE public.customers SET segment = 'booked' WHERE id = p_customer_id;
    RETURN;
  END IF;

  UPDATE public.customers
  SET segment = 'feedback_lead'
  WHERE id = p_customer_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Presence columns + touch RPC
-- ---------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS checkout_last_seen_at timestamptz;

ALTER TABLE public.pending_customers
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

COMMENT ON COLUMN public.bookings.checkout_last_seen_at IS
  'Last client heartbeat while unpaid checkout is in progress.';
COMMENT ON COLUMN public.pending_customers.last_seen_at IS
  'Last client heartbeat while pending checkout (pre-payment) is in progress.';

CREATE INDEX IF NOT EXISTS idx_bookings_checkout_last_seen
  ON public.bookings (checkout_last_seen_at)
  WHERE status = 'pending_payment';

CREATE INDEX IF NOT EXISTS idx_pending_customers_last_seen
  ON public.pending_customers (last_seen_at);

CREATE OR REPLACE FUNCTION public.touch_checkout_presence(
  p_booking_id bigint DEFAULT NULL,
  p_pending_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_booking_ok boolean := false;
  v_pending_ok boolean := false;
BEGIN
  IF p_booking_id IS NOT NULL THEN
    UPDATE public.bookings
    SET checkout_last_seen_at = v_now
    WHERE id = p_booking_id
      AND lower(COALESCE(status, '')) = 'pending_payment';
    v_booking_ok := FOUND;
  END IF;

  IF p_pending_id IS NOT NULL THEN
    UPDATE public.pending_customers
    SET last_seen_at = v_now
    WHERE id = p_pending_id;
    v_pending_ok := FOUND;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_touched', v_booking_ok,
    'pending_touched', v_pending_ok,
    'at', v_now
  );
END;
$$;

ALTER FUNCTION public.touch_checkout_presence(bigint, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.touch_checkout_presence(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_checkout_presence(bigint, uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Upsert precedence: sticky unsubscribed/converted; allow reminded -> expired
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
    CASE WHEN p_set_reminder_sent OR p_status = 'reminded' THEN now() ELSE NULL END,
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
      -- Sticky terminal CRM states
      WHEN ac.status = 'unsubscribed' THEN ac.status
      WHEN ac.status = 'converted' THEN ac.status
      -- Intentional leave wins over passive timeout/reminder
      WHEN ac.status = 'left_early' AND EXCLUDED.status IN ('expired', 'reminded', 'open') THEN ac.status
      WHEN EXCLUDED.status = 'left_early' THEN EXCLUDED.status
      -- Allow reminded -> expired progression (and any other non-sticky overwrite)
      ELSE EXCLUDED.status
    END,
    reminder_sent_at = CASE
      WHEN p_set_reminder_sent OR p_status = 'reminded' THEN COALESCE(ac.reminder_sent_at, now())
      ELSE ac.reminder_sent_at
    END,
    expired_at = CASE
      WHEN p_status = 'expired'
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
-- 6) finalize_unfinished_checkout — single teardown path
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
BEGIN
  v_reason := lower(COALESCE(NULLIF(trim(p_reason), ''), 'left_early'));
  IF v_reason NOT IN ('left_early', 'reminded', 'expired') THEN
    v_reason := 'left_early';
  END IF;

  SELECT id, status, addons, created_at, total_price, email
    INTO rec
    FROM public.bookings
   WHERE id = p_booking_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found');
  END IF;

  IF lower(COALESCE(rec.status, '')) = 'booking_not_finished' THEN
    already_done := true;
    -- Still ensure CRM lead exists / is up to date for this reason
    v_crm_id := public.upsert_abandoned_checkout_from_booking(
      rec.id,
      v_reason,
      v_reason = 'reminded'
    );
    RETURN jsonb_build_object(
      'ok', true,
      'already_finalized', true,
      'booking_id', rec.id,
      'reason', v_reason,
      'restocked', false,
      'abandoned_checkout_id', v_crm_id
    );
  END IF;

  IF lower(COALESCE(rec.status, '')) IS DISTINCT FROM 'pending_payment' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_pending_payment',
      'status', rec.status
    );
  END IF;

  -- Restock equipment hold if still active
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

  v_notes := CASE v_reason
    WHEN 'reminded' THEN 'Idle checkout — reminded (no response to still-here prompt)'
    WHEN 'expired' THEN 'Idle checkout — expired (30 minute ceiling)'
    ELSE 'Customer left booking before payment completed'
  END;

  UPDATE public.bookings
  SET
    status = 'booking_not_finished',
    addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('equipment_hold_active', false),
    archive_details = jsonb_build_object(
      'action', 'booking_not_finished',
      'action_at', now(),
      'initiated_by', CASE WHEN v_reason = 'left_early' THEN 'customer' ELSE 'system' END,
      'notes', v_notes,
      'reason', v_reason,
      'original_created_at', rec.created_at,
      'original_total_price', rec.total_price
    )
  WHERE id = rec.id
    AND status = 'pending_payment';

  IF NOT FOUND AND NOT already_done THEN
    RETURN jsonb_build_object('ok', false, 'error', 'status_race');
  END IF;

  v_crm_id := public.upsert_abandoned_checkout_from_booking(
    rec.id,
    v_reason,
    v_reason = 'reminded'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', rec.id,
    'reason', v_reason,
    'restocked', did_restock,
    'abandoned_checkout_id', v_crm_id
  );
END;
$$;

ALTER FUNCTION public.finalize_unfinished_checkout(bigint, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_unfinished_checkout(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_unfinished_checkout(bigint, text)
  TO service_role, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 7) Promote pending_customers row into a booking_not_finished booking
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

  -- If already linked to a booking, reuse it
  IF p.booking_id IS NOT NULL THEN
    SELECT status INTO v_existing_status FROM public.bookings WHERE id = p.booking_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'booking_id', p.booking_id,
        'already_existed', true,
        'status', v_existing_status
      );
    END IF;
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

-- ---------------------------------------------------------------------------
-- 8) Rewrite 2h cleanup to use finalize_unfinished_checkout
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
  result jsonb;
BEGIN
  FOR rec IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.status = 'pending_payment'
      AND b.created_at < now() - p_older_than
    ORDER BY b.id
  LOOP
    result := public.finalize_unfinished_checkout(rec.id, 'expired');
    booking_id := rec.id;
    restocked := COALESCE((result->>'restocked')::boolean, false);
    cancelled := COALESCE((result->>'ok')::boolean, false);
    RETURN NEXT;
  END LOOP;
END;
$$;

ALTER FUNCTION public.cleanup_abandoned_pending_payment_bookings(interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cleanup_abandoned_pending_payment_bookings(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_pending_payment_bookings(interval) TO service_role;

-- ---------------------------------------------------------------------------
-- 9) Unsubscribe tokens + process_unsubscribe (paid-history safe)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.unsubscribe_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  token text NOT NULL UNIQUE,
  abandoned_checkout_id bigint REFERENCES public.abandoned_checkouts(id) ON DELETE SET NULL,
  booking_id bigint REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_id bigint REFERENCES public.customers(id) ON DELETE SET NULL,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_token ON public.unsubscribe_tokens (token);
CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_email ON public.unsubscribe_tokens (email);

ALTER TABLE public.unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manage unsubscribe_tokens" ON public.unsubscribe_tokens;
CREATE POLICY "Service role manage unsubscribe_tokens"
  ON public.unsubscribe_tokens
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins read unsubscribe_tokens" ON public.unsubscribe_tokens;
CREATE POLICY "Admins read unsubscribe_tokens"
  ON public.unsubscribe_tokens
  FOR SELECT
  USING ((auth.role() = 'service_role') OR public.is_admin());

CREATE OR REPLACE FUNCTION public.create_unsubscribe_token(
  p_abandoned_checkout_id bigint DEFAULT NULL,
  p_booking_id bigint DEFAULT NULL,
  p_customer_id bigint DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_token text;
  v_email text;
  v_customer_id bigint;
  v_booking_id bigint;
  v_ac_id bigint;
BEGIN
  v_ac_id := p_abandoned_checkout_id;
  v_booking_id := p_booking_id;
  v_customer_id := p_customer_id;
  v_email := lower(trim(COALESCE(p_email, '')));

  IF v_ac_id IS NOT NULL AND (v_email = '' OR v_booking_id IS NULL) THEN
    SELECT
      lower(trim(ac.email)),
      ac.booking_id
    INTO v_email, v_booking_id
    FROM public.abandoned_checkouts ac
    WHERE ac.id = v_ac_id;
  END IF;

  IF v_booking_id IS NOT NULL AND (v_email = '' OR v_customer_id IS NULL) THEN
    SELECT
      lower(trim(b.email)),
      b.customer_id
    INTO v_email, v_customer_id
    FROM public.bookings b
    WHERE b.id = v_booking_id;
  END IF;

  IF v_email IS NULL OR length(v_email) = 0 THEN
    RAISE EXCEPTION 'email required for unsubscribe token';
  END IF;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  INSERT INTO public.unsubscribe_tokens (
    token, abandoned_checkout_id, booking_id, customer_id, email, expires_at
  )
  VALUES (
    v_token,
    v_ac_id,
    v_booking_id,
    v_customer_id,
    v_email,
    timezone('utc', now()) + interval '365 days'
  );

  RETURN v_token;
END;
$$;

ALTER FUNCTION public.create_unsubscribe_token(bigint, bigint, bigint, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_unsubscribe_token(bigint, bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_unsubscribe_token(bigint, bigint, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.process_unsubscribe(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
  ac record;
  v_customer_id bigint;
  v_booking_id bigint;
  v_email text;
  v_has_paid boolean := false;
  v_deleted_booking boolean := false;
  v_deleted_customer boolean := false;
  v_deleted_pending int := 0;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  SELECT * INTO t
  FROM public.unsubscribe_tokens
  WHERE token = trim(p_token)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF t.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_processed', true);
  END IF;

  IF t.expires_at < timezone('utc', now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired_token');
  END IF;

  v_email := lower(trim(t.email));
  v_booking_id := t.booking_id;
  v_customer_id := t.customer_id;

  -- Prefer abandoned_checkout linkage
  IF t.abandoned_checkout_id IS NOT NULL THEN
    SELECT * INTO ac FROM public.abandoned_checkouts WHERE id = t.abandoned_checkout_id;
    IF FOUND THEN
      v_booking_id := COALESCE(v_booking_id, ac.booking_id);
      v_email := COALESCE(NULLIF(v_email, ''), lower(trim(ac.email)));
      UPDATE public.abandoned_checkouts
      SET
        status = 'unsubscribed',
        marketing_eligible = false,
        updated_at = now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('unsubscribed_at', now())
      WHERE id = ac.id;
    END IF;
  ELSIF v_booking_id IS NOT NULL THEN
    PERFORM public.upsert_abandoned_checkout_from_booking(v_booking_id, 'unsubscribed', false);
    UPDATE public.abandoned_checkouts
    SET marketing_eligible = false, status = 'unsubscribed', updated_at = now()
    WHERE booking_id = v_booking_id;
  END IF;

  -- Also mark any other abandoned_checkouts for this email
  UPDATE public.abandoned_checkouts
  SET
    status = 'unsubscribed',
    marketing_eligible = false,
    updated_at = now()
  WHERE lower(trim(email)) = v_email
    AND status IS DISTINCT FROM 'unsubscribed';

  IF v_customer_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE lower(trim(email)) = v_email LIMIT 1;
  END IF;

  -- Delete unfinished booking only (never paid history)
  IF v_booking_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = v_booking_id
        AND lower(COALESCE(b.status, '')) IN (
          'booking_not_finished',
          'pending_payment',
          'cancelled',
          'canceled'
        )
    ) THEN
      -- Clear FKs that may block delete
      UPDATE public.pending_customers SET booking_id = NULL WHERE booking_id = v_booking_id;
      UPDATE public.unsubscribe_tokens SET booking_id = NULL WHERE booking_id = v_booking_id;
      IF to_regclass('public.magic_link_tokens') IS NOT NULL THEN
        EXECUTE 'UPDATE public.magic_link_tokens SET order_id = NULL WHERE order_id = $1'
          USING v_booking_id;
      END IF;
      DELETE FROM public.feedback_tokens WHERE booking_id = v_booking_id;
      DELETE FROM public.feedback_responses WHERE booking_id = v_booking_id;
      BEGIN
        DELETE FROM public.bookings WHERE id = v_booking_id;
        v_deleted_booking := true;
      EXCEPTION WHEN foreign_key_violation THEN
        -- Keep CRM row; leave booking but ensure it is not active
        UPDATE public.bookings
        SET status = 'booking_not_finished',
            addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('equipment_hold_active', false)
        WHERE id = v_booking_id;
        v_deleted_booking := false;
      END;
    END IF;
  END IF;

  -- Remove pending checkout drafts for this email
  DELETE FROM public.pending_customers
  WHERE lower(trim(email)) = v_email;
  GET DIAGNOSTICS v_deleted_pending = ROW_COUNT;

  -- Delete feedback for this customer if they only ever abandoned
  IF v_customer_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.customer_id = v_customer_id
        AND lower(COALESCE(b.status, '')) NOT IN (
          'pending_payment',
          'cancelled',
          'canceled',
          'booking_not_finished'
        )
    ) INTO v_has_paid;

    IF NOT v_has_paid THEN
      DELETE FROM public.feedback_responses WHERE customer_id = v_customer_id;
      DELETE FROM public.feedback_tokens WHERE customer_id = v_customer_id;
      DELETE FROM public.customers WHERE id = v_customer_id;
      v_deleted_customer := true;
    END IF;
  END IF;

  UPDATE public.unsubscribe_tokens
  SET used_at = timezone('utc', now())
  WHERE id = t.id;

  RETURN jsonb_build_object(
    'ok', true,
    'email', v_email,
    'deleted_booking', v_deleted_booking,
    'deleted_customer', v_deleted_customer,
    'deleted_pending_count', v_deleted_pending
  );
END;
$$;

ALTER FUNCTION public.process_unsubscribe(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.process_unsubscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_unsubscribe(text) TO service_role, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10) Candidate finder for sweep edge function
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
  -- Pending payment bookings with stale / missing heartbeat
  RETURN QUERY
  SELECT
    b.id AS booking_id,
    NULL::uuid AS pending_id,
    'booking'::text AS source
  FROM public.bookings b
  WHERE b.status = 'pending_payment'
    AND COALESCE(b.checkout_last_seen_at, b.created_at) < now() - p_stale_after
  ORDER BY b.id;

  -- Pending customers (no booking yet) with stale heartbeat
  RETURN QUERY
  SELECT
    NULL::bigint AS booking_id,
    pc.id AS pending_id,
    'pending'::text AS source
  FROM public.pending_customers pc
  WHERE pc.booking_id IS NULL
    AND COALESCE(pc.last_seen_at, pc.created_at) < now() - p_stale_after
    AND COALESCE(pc.email, '') <> ''
  ORDER BY pc.created_at;
END;
$$;

ALTER FUNCTION public.find_stale_unfinished_checkouts(interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.find_stale_unfinished_checkouts(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_stale_unfinished_checkouts(interval) TO service_role;

-- ---------------------------------------------------------------------------
-- 11) Sweep cron every minute
-- ---------------------------------------------------------------------------
DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname = 'sweep-unfinished-checkouts'
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'sweep-unfinished-checkouts',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/sweep-unfinished-checkouts',
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
