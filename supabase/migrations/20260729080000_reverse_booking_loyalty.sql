-- Allow cancelled/reschedule loyalty adjustments and a service-role reverse helper.

ALTER TABLE public.loyalty_transactions
  DROP CONSTRAINT IF EXISTS loyalty_transactions_transaction_type_check;

ALTER TABLE public.loyalty_transactions
  ADD CONSTRAINT loyalty_transactions_transaction_type_check
  CHECK (
    transaction_type IN (
      'earned',
      'redeemed',
      'admin_adjustment_add',
      'admin_adjustment_remove',
      'referral_bonus',
      'cancelled',
      'reschedule_adjustment'
    )
  );

-- One cancellation reversal per booking
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_transactions_cancelled_booking_unique
  ON public.loyalty_transactions (booking_id)
  WHERE transaction_type = 'cancelled';

/**
 * Reverse all still-active earned loyalty points for a booking (service_role only).
 * Idempotent: if a cancelled row already exists for the booking, returns already_processed.
 */
CREATE OR REPLACE FUNCTION public.reverse_booking_loyalty_points(
  p_booking_id bigint,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(
  already_processed boolean,
  points_reversed integer,
  new_balance integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id bigint;
  v_earned integer := 0;
  v_already_cancelled integer := 0;
  v_balance integer := 0;
  v_addons jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'booking_id is required';
  END IF;

  SELECT b.customer_id, COALESCE(b.addons, '{}'::jsonb)
    INTO v_customer_id, v_addons
    FROM public.bookings b
   WHERE b.id = p_booking_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Booking % not found or missing customer', p_booking_id;
  END IF;

  SELECT COALESCE(SUM(lt.points_amount), 0)
    INTO v_already_cancelled
    FROM public.loyalty_transactions lt
   WHERE lt.booking_id = p_booking_id
     AND lt.transaction_type = 'cancelled';

  IF v_already_cancelled > 0 THEN
    SELECT lp.points_balance INTO v_balance
      FROM public.loyalty_points lp
     WHERE lp.customer_id = v_customer_id;
    already_processed := true;
    points_reversed := 0;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  -- Net earned for this booking: earned + reschedule_adjustment (can be negative)
  SELECT COALESCE(SUM(
           CASE
             WHEN lt.transaction_type = 'earned' THEN lt.points_amount
             WHEN lt.transaction_type = 'reschedule_adjustment' THEN lt.points_amount
             ELSE 0
           END
         ), 0)
    INTO v_earned
    FROM public.loyalty_transactions lt
   WHERE lt.booking_id = p_booking_id
     AND lt.transaction_type IN ('earned', 'reschedule_adjustment');

  -- Fallback to addons snapshot if no earned row (legacy)
  IF v_earned <= 0 THEN
    v_earned := GREATEST(0, COALESCE((v_addons->>'loyaltyPointsEarned')::integer, 0));
  END IF;

  IF v_earned <= 0 THEN
    already_processed := true;
    points_reversed := 0;
    SELECT lp.points_balance INTO v_balance
      FROM public.loyalty_points lp
     WHERE lp.customer_id = v_customer_id;
    new_balance := COALESCE(v_balance, 0);
    -- Still clear addons flag
    UPDATE public.bookings
       SET addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object(
             'loyaltyPointsEarned', 0,
             'loyaltyPointsReversedOnCancel', 0
           )
     WHERE id = p_booking_id;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.loyalty_points (customer_id, points_balance, total_points_earned, total_points_redeemed)
  VALUES (v_customer_id, 0, 0, 0)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT lp.points_balance INTO v_balance
    FROM public.loyalty_points lp
   WHERE lp.customer_id = v_customer_id
   FOR UPDATE;

  IF COALESCE(v_balance, 0) < v_earned THEN
    -- Clamp to available balance so cancel still completes
    v_earned := GREATEST(0, COALESCE(v_balance, 0));
  END IF;

  IF v_earned > 0 THEN
    UPDATE public.loyalty_points
       SET points_balance = points_balance - v_earned,
           total_points_earned = GREATEST(0, total_points_earned - v_earned),
           last_updated = now()
     WHERE customer_id = v_customer_id
     RETURNING points_balance INTO v_balance;

    INSERT INTO public.loyalty_transactions (
      customer_id,
      transaction_type,
      points_amount,
      booking_id,
      notes
    )
    VALUES (
      v_customer_id,
      'cancelled',
      v_earned,
      p_booking_id,
      COALESCE(p_reason, format('Cancelled booking #%s — loyalty points reversed', p_booking_id))
    );
  END IF;

  UPDATE public.bookings
     SET addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object(
           'loyaltyPointsEarned', 0,
           'loyaltyPointsReversedOnCancel', v_earned
         )
   WHERE id = p_booking_id;

  already_processed := false;
  points_reversed := v_earned;
  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END;
$$;

/**
 * Set booking loyalty earned points to match a new total (after reschedule charge change).
 * Applies a signed reschedule_adjustment transaction. Service role only.
 */
CREATE OR REPLACE FUNCTION public.sync_booking_loyalty_to_total(
  p_booking_id bigint,
  p_new_total numeric,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(
  already_processed boolean,
  points_delta integer,
  new_balance integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id bigint;
  v_points_per_dollar integer;
  v_target integer;
  v_current_net integer := 0;
  v_delta integer;
  v_balance integer := 0;
  v_addons jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'booking_id is required';
  END IF;

  SELECT b.customer_id, COALESCE(b.addons, '{}'::jsonb)
    INTO v_customer_id, v_addons
    FROM public.bookings b
   WHERE b.id = p_booking_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Booking % not found or missing customer', p_booking_id;
  END IF;

  -- Do not sync cancelled bookings
  IF EXISTS (
    SELECT 1 FROM public.loyalty_transactions lt
     WHERE lt.booking_id = p_booking_id AND lt.transaction_type = 'cancelled'
  ) THEN
    already_processed := true;
    points_delta := 0;
    SELECT lp.points_balance INTO v_balance FROM public.loyalty_points lp WHERE lp.customer_id = v_customer_id;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE(ls.points_per_dollar, 10)
    INTO v_points_per_dollar
    FROM public.loyalty_settings ls
   LIMIT 1;
  v_points_per_dollar := COALESCE(v_points_per_dollar, 10);

  v_target := GREATEST(0, FLOOR(COALESCE(p_new_total, 0) * v_points_per_dollar)::integer);

  SELECT COALESCE(SUM(
           CASE
             WHEN lt.transaction_type = 'earned' THEN lt.points_amount
             WHEN lt.transaction_type = 'reschedule_adjustment' THEN lt.points_amount
             ELSE 0
           END
         ), 0)
    INTO v_current_net
    FROM public.loyalty_transactions lt
   WHERE lt.booking_id = p_booking_id
     AND lt.transaction_type IN ('earned', 'reschedule_adjustment');

  IF v_current_net = 0 THEN
    v_current_net := GREATEST(0, COALESCE((v_addons->>'loyaltyPointsEarned')::integer, 0));
  END IF;

  v_delta := v_target - v_current_net;
  IF v_delta = 0 THEN
    already_processed := true;
    points_delta := 0;
    SELECT lp.points_balance INTO v_balance FROM public.loyalty_points lp WHERE lp.customer_id = v_customer_id;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.loyalty_points (customer_id, points_balance, total_points_earned, total_points_redeemed)
  VALUES (v_customer_id, 0, 0, 0)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT lp.points_balance INTO v_balance
    FROM public.loyalty_points lp
   WHERE lp.customer_id = v_customer_id
   FOR UPDATE;

  IF v_delta > 0 THEN
    UPDATE public.loyalty_points
       SET points_balance = points_balance + v_delta,
           total_points_earned = total_points_earned + v_delta,
           last_updated = now()
     WHERE customer_id = v_customer_id
     RETURNING points_balance INTO v_balance;
  ELSE
    IF COALESCE(v_balance, 0) < abs(v_delta) THEN
      v_delta := -GREATEST(0, COALESCE(v_balance, 0));
    END IF;
    IF v_delta <> 0 THEN
      UPDATE public.loyalty_points
         SET points_balance = points_balance + v_delta,
             total_points_earned = GREATEST(0, total_points_earned + v_delta),
             last_updated = now()
       WHERE customer_id = v_customer_id
       RETURNING points_balance INTO v_balance;
    END IF;
  END IF;

  IF v_delta <> 0 THEN
    INSERT INTO public.loyalty_transactions (
      customer_id,
      transaction_type,
      points_amount,
      booking_id,
      notes
    )
    VALUES (
      v_customer_id,
      'reschedule_adjustment',
      v_delta,
      p_booking_id,
      COALESCE(p_reason, format('Reschedule price adjustment for booking #%s', p_booking_id))
    );
  END IF;

  UPDATE public.bookings
     SET addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('loyaltyPointsEarned', v_target)
   WHERE id = p_booking_id;

  already_processed := false;
  points_delta := v_delta;
  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_booking_loyalty_points(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_booking_loyalty_to_total(bigint, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_booking_loyalty_points(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_booking_loyalty_to_total(bigint, numeric, text) TO service_role;
