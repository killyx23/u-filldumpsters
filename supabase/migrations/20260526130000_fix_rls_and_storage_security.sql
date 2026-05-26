-- Security hardening: RLS policies, RPC guards, storage, and grants.
-- See security audit plan v2.

-- ---------------------------------------------------------------------------
-- Helper: booking ownership for authenticated customers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_owns_booking(p_booking_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.customers c ON c.id = b.customer_id
    WHERE b.id = p_booking_id
      AND c.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Pending customer RPCs (replace direct anon table access during checkout)
-- ---------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.verify_portal_booking_access(
  p_booking_id bigint,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_normalized_phone text;
  v_booking_phone text;
BEGIN
  v_normalized_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF length(v_normalized_phone) < 4 THEN
    RAISE EXCEPTION 'Invalid phone number';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  v_booking_phone := regexp_replace(COALESCE(v_booking.phone, ''), '\D', '', 'g');
  IF NOT v_booking_phone LIKE ('%' || right(v_normalized_phone, 4)) THEN
    RAISE EXCEPTION 'Phone number does not match order';
  END IF;

  RETURN to_jsonb(v_booking);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_customer_by_id(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_pending_booking(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_portal_booking_access(bigint, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_owns_booking(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_customer_license_from_checkout(
  p_booking_id bigint,
  p_license_plate text,
  p_license_image_urls jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.customers c
  SET
    license_plate = p_license_plate,
    license_image_urls = p_license_image_urls
  FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.customer_id = c.id
    AND b.status = 'pending_payment';
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_customer_license_from_checkout(bigint, text, jsonb)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_booking_for_post_checkout(
  p_booking_id bigint,
  p_payment_intent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_customer jsonb;
BEGIN
  IF p_payment_intent IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.stripe_payment_info spi
    WHERE spi.booking_id = p_booking_id
      AND (
        spi.stripe_payment_intent_id = p_payment_intent
        OR spi.stripe_checkout_session_id = p_payment_intent
      )
  ) THEN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
    SELECT to_jsonb(c.*) INTO v_customer
    FROM public.customers c
    WHERE c.id = v_booking.customer_id;
    RETURN jsonb_build_object('booking', to_jsonb(v_booking), 'customers', v_customer);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stripe_payment_info spi WHERE spi.booking_id = p_booking_id
  ) THEN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
    SELECT to_jsonb(c.*) INTO v_customer
    FROM public.customers c
    WHERE c.id = v_booking.customer_id;
    RETURN jsonb_build_object('booking', to_jsonb(v_booking), 'customers', v_customer);
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
    AND status = 'pending_payment'
    AND created_at > (now() - interval '7 days');

  IF FOUND THEN
    SELECT to_jsonb(c.*) INTO v_customer
    FROM public.customers c
    WHERE c.id = v_booking.customer_id;
    RETURN jsonb_build_object('booking', to_jsonb(v_booking), 'customers', v_customer);
  END IF;

  RAISE EXCEPTION 'Not authorized';
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_booking_delivery_verified(p_booking_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.bookings
  SET
    delivery_location_verified = true,
    delivery_location_verified_at = now()
  WHERE id = p_booking_id
    AND status = 'pending_payment';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_for_post_checkout(bigint, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_booking_delivery_verified(bigint)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- BOOKINGS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "bookings_public_read" ON public.bookings;
DROP POLICY IF EXISTS "public_read_bookings" ON public.bookings;
DROP POLICY IF EXISTS "bookings_insert_for_all" ON public.bookings;
DROP POLICY IF EXISTS "public_insert_bookings" ON public.bookings;
DROP POLICY IF EXISTS "bookings_admin_all_write" ON public.bookings;

DROP POLICY IF EXISTS "users_update_own_bookings" ON public.bookings;
CREATE POLICY "bookings_select_own"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (customer_id = public.current_customer_id());

CREATE POLICY "users_update_own_bookings"
  ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (customer_id = public.current_customer_id())
  WITH CHECK (customer_id = public.current_customer_id());

REVOKE ALL ON TABLE public.bookings FROM anon;
GRANT SELECT, UPDATE ON TABLE public.bookings TO authenticated;

-- ---------------------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "customers_public_insert_update" ON public.customers;
DROP POLICY IF EXISTS "Customers can read own row" ON public.customers;

CREATE POLICY "customers_select_own"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR id = public.current_customer_id());

REVOKE ALL ON TABLE public.customers FROM anon;
GRANT SELECT, UPDATE ON TABLE public.customers TO authenticated;

-- ---------------------------------------------------------------------------
-- EMAIL_VERIFICATIONS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "public_insert_email_verifications" ON public.email_verifications;
DROP POLICY IF EXISTS "public_read_email_verifications" ON public.email_verifications;
DROP POLICY IF EXISTS "public_update_email_verifications" ON public.email_verifications;

REVOKE ALL ON TABLE public.email_verifications FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- PENDING_CUSTOMERS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "public_insert_pending_customers" ON public.pending_customers;
DROP POLICY IF EXISTS "public_select_pending_customers" ON public.pending_customers;
DROP POLICY IF EXISTS "public_update_pending_customers" ON public.pending_customers;

REVOKE ALL ON TABLE public.pending_customers FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- COUPONS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all for admin" ON public.coupons;

CREATE POLICY "coupons_select_active"
  ON public.coupons
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "coupons_admin_all"
  ON public.coupons
  FOR ALL
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

REVOKE INSERT, UPDATE, DELETE ON TABLE public.coupons FROM anon;

-- ---------------------------------------------------------------------------
-- CONTACT_MESSAGES
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "TEMP_DEBUG_ALLOW_ALL" ON public.contact_messages;

CREATE POLICY "contact_messages_admin_all"
  ON public.contact_messages
  FOR ALL
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

REVOKE ALL ON TABLE public.contact_messages FROM anon;

-- ---------------------------------------------------------------------------
-- CUSTOMER_NOTES
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "TEMP_DEBUG_ALLOW_ALL" ON public.customer_notes;
DROP POLICY IF EXISTS "anon_can_insert_customer_notes" ON public.customer_notes;

CREATE POLICY "customer_notes_select_own"
  ON public.customer_notes
  FOR SELECT
  TO authenticated
  USING (customer_id = public.current_customer_id() OR public.is_admin());

CREATE POLICY "customer_notes_insert_own"
  ON public.customer_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = public.current_customer_id());

CREATE POLICY "customer_notes_update_own"
  ON public.customer_notes
  FOR UPDATE
  TO authenticated
  USING (customer_id = public.current_customer_id() OR public.is_admin())
  WITH CHECK (customer_id = public.current_customer_id() OR public.is_admin());

CREATE POLICY "customer_notes_admin_all"
  ON public.customer_notes
  FOR ALL
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

REVOKE ALL ON TABLE public.customer_notes FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_notes TO authenticated;

-- ---------------------------------------------------------------------------
-- REVIEWS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "TEMP_DEBUG_ALLOW_ALL" ON public.reviews;

CREATE POLICY "reviews_admin_all"
  ON public.reviews
  FOR ALL
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- Keep: Allow anonymous read access to public reviews, Customers can create reviews...

-- ---------------------------------------------------------------------------
-- BOOKING_EQUIPMENT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "TEMP_DEBUG_ALLOW_ALL" ON public.booking_equipment;

CREATE POLICY "booking_equipment_select_own"
  ON public.booking_equipment
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_equipment.booking_id
        AND b.customer_id = public.current_customer_id()
    )
    OR public.is_admin()
  );

CREATE POLICY "booking_equipment_admin_all"
  ON public.booking_equipment
  FOR ALL
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

REVOKE ALL ON TABLE public.booking_equipment FROM anon;
GRANT SELECT ON TABLE public.booking_equipment TO authenticated;

-- ---------------------------------------------------------------------------
-- EQUIPMENT (catalog read-only for public; admin write)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public read and controlled updates" ON public.equipment;

CREATE POLICY "equipment_public_read"
  ON public.equipment
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "equipment_admin_write"
  ON public.equipment
  FOR ALL
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- SERVICES
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated users to update services" ON public.services;

CREATE POLICY "services_admin_write"
  ON public.services
  FOR ALL
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- Keep public SELECT policies on services

-- ---------------------------------------------------------------------------
-- TYPING_INDICATORS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow admins full access to typing indicators" ON public.typing_indicators;
DROP POLICY IF EXISTS "Allow customers access to typing indicators" ON public.typing_indicators;

CREATE POLICY "typing_indicators_customer_own"
  ON public.typing_indicators
  FOR ALL
  TO authenticated
  USING (
    conversation_id = ('cust_' || public.current_customer_id()::text)
    OR public.is_admin()
  )
  WITH CHECK (
    conversation_id = ('cust_' || public.current_customer_id()::text)
    OR public.is_admin()
  );

REVOKE ALL ON TABLE public.typing_indicators FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.typing_indicators TO authenticated;

-- ---------------------------------------------------------------------------
-- RESCHEDULE_HISTORY_LOGS
-- ---------------------------------------------------------------------------
ALTER TABLE public.reschedule_history_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reschedule_history_logs_service_role"
  ON public.reschedule_history_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "reschedule_history_logs_admin_all"
  ON public.reschedule_history_logs
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "reschedule_history_logs_customer_select"
  ON public.reschedule_history_logs
  FOR SELECT
  TO authenticated
  USING (public.customer_owns_booking(booking_id));

CREATE POLICY "reschedule_history_logs_customer_insert"
  ON public.reschedule_history_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.customer_owns_booking(booking_id));

REVOKE ALL ON TABLE public.reschedule_history_logs FROM anon;
GRANT SELECT, INSERT ON TABLE public.reschedule_history_logs TO authenticated;

-- ---------------------------------------------------------------------------
-- STRIPE_PAYMENT_INFO — align admin check with is_admin()
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins via roles table" ON public.stripe_payment_info;

CREATE POLICY "stripe_payment_info_admin_all"
  ON public.stripe_payment_info
  FOR ALL
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- LOYALTY RPCs — service_role only (preserve existing logic, add auth guard)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_loyalty_points(
  p_customer_id bigint,
  p_points integer,
  p_transaction_type text,
  p_booking_id bigint DEFAULT NULL,
  p_referral_id bigint DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(already_processed boolean, new_balance integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount integer;
  v_balance integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id is required';
  END IF;

  v_amount := abs(COALESCE(p_points, 0));
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid points amount';
  END IF;

  IF p_transaction_type = 'earned' AND p_booking_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public.loyalty_transactions lt
       WHERE lt.booking_id = p_booking_id
         AND lt.transaction_type = 'earned'
    ) THEN
      SELECT lp.points_balance
        INTO v_balance
        FROM public.loyalty_points lp
       WHERE lp.customer_id = p_customer_id;

      already_processed := true;
      new_balance := COALESCE(v_balance, 0);
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.loyalty_points (
    customer_id,
    points_balance,
    total_points_earned,
    total_points_redeemed
  )
  VALUES (p_customer_id, 0, 0, 0)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT lp.points_balance
    INTO v_balance
    FROM public.loyalty_points lp
   WHERE lp.customer_id = p_customer_id
   FOR UPDATE;

  IF p_transaction_type = 'redeemed' THEN
    IF COALESCE(v_balance, 0) < v_amount THEN
      RAISE EXCEPTION 'Insufficient points';
    END IF;

    UPDATE public.loyalty_points
       SET points_balance = points_balance - v_amount,
           total_points_redeemed = total_points_redeemed + v_amount,
           last_updated = now()
     WHERE customer_id = p_customer_id
     RETURNING points_balance INTO v_balance;

    INSERT INTO public.loyalty_transactions (
      customer_id,
      transaction_type,
      points_amount,
      booking_id,
      referral_id,
      notes
    )
    VALUES (
      p_customer_id,
      'redeemed',
      v_amount,
      p_booking_id,
      p_referral_id,
      p_notes
    );
  ELSIF p_transaction_type = 'earned' THEN
    UPDATE public.loyalty_points
       SET points_balance = points_balance + v_amount,
           total_points_earned = total_points_earned + v_amount,
           last_updated = now()
     WHERE customer_id = p_customer_id
     RETURNING points_balance INTO v_balance;

    INSERT INTO public.loyalty_transactions (
      customer_id,
      transaction_type,
      points_amount,
      booking_id,
      referral_id,
      notes
    )
    VALUES (
      p_customer_id,
      'earned',
      v_amount,
      p_booking_id,
      p_referral_id,
      p_notes
    );
  ELSIF p_transaction_type = 'referral_bonus' THEN
    UPDATE public.loyalty_points
       SET points_balance = points_balance + v_amount,
           total_points_earned = total_points_earned + v_amount,
           last_updated = now()
     WHERE customer_id = p_customer_id
     RETURNING points_balance INTO v_balance;

    INSERT INTO public.loyalty_transactions (
      customer_id,
      transaction_type,
      points_amount,
      booking_id,
      referral_id,
      notes
    )
    VALUES (
      p_customer_id,
      'referral_bonus',
      v_amount,
      p_booking_id,
      p_referral_id,
      p_notes
    );
  ELSE
    RAISE EXCEPTION 'Unsupported transaction type: %', p_transaction_type;
  END IF;

  already_processed := false;
  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_loyalty_points(
  p_customer_id bigint,
  p_points_delta integer,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(new_balance integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta integer;
  v_balance integer;
  v_tx_type text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id is required';
  END IF;

  v_delta := COALESCE(p_points_delta, 0);
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'points delta must be non-zero';
  END IF;

  INSERT INTO public.loyalty_points (
    customer_id,
    points_balance,
    total_points_earned,
    total_points_redeemed
  )
  VALUES (p_customer_id, 0, 0, 0)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT lp.points_balance
    INTO v_balance
    FROM public.loyalty_points lp
   WHERE lp.customer_id = p_customer_id
   FOR UPDATE;

  IF v_delta > 0 THEN
    v_tx_type := 'admin_adjustment_add';
    UPDATE public.loyalty_points
       SET points_balance = points_balance + v_delta,
           total_points_earned = total_points_earned + v_delta,
           last_updated = now()
     WHERE customer_id = p_customer_id
     RETURNING points_balance INTO v_balance;
  ELSE
    v_tx_type := 'admin_adjustment_remove';
    IF COALESCE(v_balance, 0) + v_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient points';
    END IF;
    UPDATE public.loyalty_points
       SET points_balance = points_balance + v_delta,
           total_points_redeemed = total_points_redeemed + abs(v_delta),
           last_updated = now()
     WHERE customer_id = p_customer_id
     RETURNING points_balance INTO v_balance;
  END IF;

  INSERT INTO public.loyalty_transactions (
    customer_id,
    transaction_type,
    points_amount,
    notes
  )
  VALUES (
    p_customer_id,
    v_tx_type,
    abs(v_delta),
    COALESCE(p_reason, 'Manual admin adjustment')
  );

  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_referral_for_booking(
  p_booking_id bigint,
  p_referee_customer_id bigint,
  p_referral_code text,
  p_bonus_points integer DEFAULT 100
)
RETURNS TABLE(referral_id bigint, rewarded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_bonus integer;
  v_adjust record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_booking_id IS NULL OR p_referee_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(trim(p_referral_code), '') = '' THEN
    RETURN;
  END IF;

  v_bonus := GREATEST(COALESCE(p_bonus_points, 0), 0);

  SELECT *
    INTO v_referral
    FROM public.referrals r
   WHERE lower(r.referral_code) = lower(trim(p_referral_code))
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  referral_id := v_referral.id;

  IF v_referral.referrer_customer_id = p_referee_customer_id THEN
    rewarded := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_referral.completed_booking_id = p_booking_id THEN
    rewarded := v_referral.status = 'rewarded';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.referrals
     SET referee_customer_id = COALESCE(referee_customer_id, p_referee_customer_id),
         completed_booking_id = p_booking_id,
         status = CASE WHEN v_bonus > 0 THEN 'rewarded' ELSE 'completed' END,
         referrer_points_awarded = CASE WHEN v_bonus > 0 THEN v_bonus ELSE referrer_points_awarded END,
         completed_at = COALESCE(completed_at, now())
   WHERE id = v_referral.id;

  rewarded := false;

  IF v_bonus > 0 AND v_referral.status <> 'rewarded' THEN
    SELECT *
      INTO v_adjust
      FROM public.adjust_loyalty_points(
        v_referral.referrer_customer_id,
        v_bonus,
        'referral_bonus',
        p_booking_id,
        v_referral.id,
        'Referral bonus for booking #' || p_booking_id::text
      ) AS t(already_processed boolean, new_balance integer);

    rewarded := NOT COALESCE(v_adjust.already_processed, false);
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_loyalty_points(bigint, integer, text, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_adjust_loyalty_points(bigint, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_referral_for_booking(bigint, bigint, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_loyalty_points(bigint, integer, text, bigint, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_loyalty_points(bigint, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_referral_for_booking(bigint, bigint, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- RENTAL_ACCESS_CODES
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "public_insert_access_codes" ON public.rental_access_codes;
REVOKE ALL ON TABLE public.rental_access_codes FROM anon;
GRANT SELECT ON TABLE public.rental_access_codes TO authenticated;

-- ---------------------------------------------------------------------------
-- RESOURCE_ACCESS_LOGS (admin/service only)
-- ---------------------------------------------------------------------------
CREATE POLICY "resource_access_logs_admin_all"
  ON public.resource_access_logs
  FOR ALL
  TO authenticated
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "resource_access_logs_service_role"
  ON public.resource_access_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.resource_access_logs FROM anon;

-- ---------------------------------------------------------------------------
-- Revoke dangerous function grants from anon/authenticated
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_adjust_loyalty_points(bigint, integer, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_loyalty_points(bigint, integer, text, bigint, bigint, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_referral_for_booking(bigint, bigint, text, integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_deleted_users() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_magic_tokens() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_pending_customers() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;
REVOKE ALL ON FUNCTION public.server_insert_booking(uuid, jsonb) FROM anon, authenticated;

-- Keep checkout/contact RPCs for anon
GRANT EXECUTE ON FUNCTION public.create_pending_booking(jsonb) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- STORAGE POLICIES
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "verification_documents_public_read" ON storage.objects;

DROP POLICY IF EXISTS "Admin write resource-covers" ON storage.objects;
CREATE POLICY "Admin write resource-covers"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'resource-covers' AND public.is_admin())
  WITH CHECK (bucket_id = 'resource-covers' AND public.is_admin());

DROP POLICY IF EXISTS "Admin write resource-files" ON storage.objects;
CREATE POLICY "Admin write resource-files"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'resource-files' AND public.is_admin())
  WITH CHECK (bucket_id = 'resource-files' AND public.is_admin());

DROP POLICY IF EXISTS "Admin write resource-pdfs" ON storage.objects;
CREATE POLICY "Admin write resource-pdfs"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'resource-pdfs' AND public.is_admin())
  WITH CHECK (bucket_id = 'resource-pdfs' AND public.is_admin());

DROP POLICY IF EXISTS "customer_uploads_chat_select" ON storage.objects;
CREATE POLICY "customer_uploads_chat_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'customer-uploads'
    AND (storage.foldername(name))[1] = 'chat-attachments'
    AND (
      (storage.foldername(name))[2] IN (
        SELECT id::text FROM public.customers WHERE user_id = auth.uid()
      )
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS "customer_uploads_chat_insert" ON storage.objects;
CREATE POLICY "customer_uploads_chat_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'customer-uploads'
    AND (storage.foldername(name))[1] = 'chat-attachments'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.customers WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "customer_uploads_customer_folder_insert" ON storage.objects;
CREATE POLICY "customer_uploads_customer_folder_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'customer-uploads'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.customers WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "customer_uploads_customer_select" ON storage.objects;
CREATE POLICY "customer_uploads_customer_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'customer-uploads'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.customers WHERE user_id = auth.uid()
      )
      OR public.is_admin()
    )
  );

-- Verification docs: customer/admin read (not public)
DROP POLICY IF EXISTS "verification_documents_customer_read" ON storage.objects;
CREATE POLICY "verification_documents_customer_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'verification-documents'
    AND (
      public.is_admin()
      OR (
        (storage.foldername(name))[1] = 'customers'
        AND (storage.foldername(name))[2] IN (
          SELECT id::text FROM public.customers WHERE user_id = auth.uid()
        )
      )
    )
  );

-- Checkout uploads use unassigned-* paths before a customer row exists; anon cannot
-- read customers, so unassigned policies must not reference that table (OR branches
-- are still evaluated and raise permission denied).
DROP POLICY IF EXISTS "verification_documents_unassigned_select" ON storage.objects;
CREATE POLICY "verification_documents_unassigned_select"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'verification-documents'
    AND (storage.foldername(name))[1] = 'customers'
    AND (storage.foldername(name))[3] = 'verification'
    AND (storage.foldername(name))[2] LIKE 'unassigned-%'
  );

DROP POLICY IF EXISTS "verification_documents_insert" ON storage.objects;
CREATE POLICY "verification_documents_insert_unassigned"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'verification-documents'
    AND (storage.foldername(name))[1] = 'customers'
    AND (storage.foldername(name))[3] = 'verification'
    AND (storage.foldername(name))[2] LIKE 'unassigned-%'
  );

CREATE POLICY "verification_documents_insert_customer"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'verification-documents'
    AND (storage.foldername(name))[1] = 'customers'
    AND (storage.foldername(name))[3] = 'verification'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.customers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "verification_documents_insert_admin"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'verification-documents'
    AND public.is_admin()
  );

DROP POLICY IF EXISTS "verification_documents_update" ON storage.objects;
CREATE POLICY "verification_documents_update_unassigned"
  ON storage.objects
  FOR UPDATE
  TO anon, authenticated
  USING (
    bucket_id = 'verification-documents'
    AND (storage.foldername(name))[1] = 'customers'
    AND (storage.foldername(name))[3] = 'verification'
    AND (storage.foldername(name))[2] LIKE 'unassigned-%'
  )
  WITH CHECK (
    bucket_id = 'verification-documents'
    AND (storage.foldername(name))[1] = 'customers'
    AND (storage.foldername(name))[3] = 'verification'
    AND (storage.foldername(name))[2] LIKE 'unassigned-%'
  );

CREATE POLICY "verification_documents_update_customer"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'verification-documents'
    AND (storage.foldername(name))[1] = 'customers'
    AND (storage.foldername(name))[3] = 'verification'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.customers WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'verification-documents'
    AND (storage.foldername(name))[1] = 'customers'
    AND (storage.foldername(name))[3] = 'verification'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.customers WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "verification_documents_update_admin"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'verification-documents' AND public.is_admin())
  WITH CHECK (bucket_id = 'verification-documents' AND public.is_admin());
