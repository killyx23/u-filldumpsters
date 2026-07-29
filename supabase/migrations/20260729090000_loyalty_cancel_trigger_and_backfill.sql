-- Make loyalty reverse/sync usable from DB triggers (not only edge-function JWT),
-- auto-reverse on Cancelled, sync on total_price changes, and backfill missed cancels.

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
  -- Access control: GRANT EXECUTE TO service_role only (or postgres via trigger/migration).
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

  SELECT COUNT(*)::integer
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
  v_status text;
  v_points_per_dollar integer;
  v_target integer;
  v_current_net integer := 0;
  v_delta integer;
  v_balance integer := 0;
  v_addons jsonb;
  v_had_loyalty boolean := false;
BEGIN
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'booking_id is required';
  END IF;

  SELECT b.customer_id, b.status, COALESCE(b.addons, '{}'::jsonb)
    INTO v_customer_id, v_status, v_addons
    FROM public.bookings b
   WHERE b.id = p_booking_id;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Booking % not found or missing customer', p_booking_id;
  END IF;

  IF v_status IN ('Cancelled', 'cancellation_pending') THEN
    already_processed := true;
    points_delta := 0;
    SELECT lp.points_balance INTO v_balance FROM public.loyalty_points lp WHERE lp.customer_id = v_customer_id;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

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

  v_had_loyalty := (
    v_current_net <> 0
    OR COALESCE((v_addons->>'loyaltyPointsEarned')::integer, 0) > 0
    OR EXISTS (
      SELECT 1 FROM public.loyalty_transactions lt
       WHERE lt.booking_id = p_booking_id
         AND lt.transaction_type IN ('earned', 'reschedule_adjustment')
    )
  );

  -- Do not award loyalty before finalize-booking has granted it
  IF NOT v_had_loyalty THEN
    already_processed := true;
    points_delta := 0;
    SELECT lp.points_balance INTO v_balance FROM public.loyalty_points lp WHERE lp.customer_id = v_customer_id;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_current_net = 0 THEN
    v_current_net := GREATEST(0, COALESCE((v_addons->>'loyaltyPointsEarned')::integer, 0));
  END IF;

  SELECT COALESCE(ls.points_per_dollar, 10)
    INTO v_points_per_dollar
    FROM public.loyalty_settings ls
   LIMIT 1;
  v_points_per_dollar := COALESCE(v_points_per_dollar, 10);

  v_target := GREATEST(0, FLOOR(COALESCE(p_new_total, 0) * v_points_per_dollar)::integer);
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
      COALESCE(p_reason, format('Reschedule/price adjustment for booking #%s', p_booking_id))
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

CREATE OR REPLACE FUNCTION public.bookings_loyalty_sync_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Full cancel: reverse any remaining earned points (idempotent)
  IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
    PERFORM public.reverse_booking_loyalty_points(
      NEW.id,
      format('Cancelled booking #%s — loyalty points reversed', NEW.id)
    );
    RETURN NEW;
  END IF;

  -- Charge/reschedule total change: re-sync points to new total when loyalty already exists
  IF NEW.total_price IS DISTINCT FROM OLD.total_price
     AND NEW.status IS DISTINCT FROM 'Cancelled'
     AND NEW.status IS DISTINCT FROM 'cancellation_pending'
  THEN
    PERFORM public.sync_booking_loyalty_to_total(
      NEW.id,
      NEW.total_price::numeric,
      format('Price update for booking #%s ($%s → $%s)', NEW.id, OLD.total_price, NEW.total_price)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_loyalty_sync ON public.bookings;
CREATE TRIGGER trg_bookings_loyalty_sync
  AFTER UPDATE OF status, total_price ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_loyalty_sync_trigger();

REVOKE ALL ON FUNCTION public.reverse_booking_loyalty_points(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_booking_loyalty_to_total(bigint, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_booking_loyalty_points(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_booking_loyalty_to_total(bigint, numeric, text) TO service_role;

-- Backfill: reverse loyalty for cancelled bookings that still have earned/net points
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT b.id
      FROM public.bookings b
     WHERE b.status = 'Cancelled'
       AND NOT EXISTS (
         SELECT 1 FROM public.loyalty_transactions lt
          WHERE lt.booking_id = b.id AND lt.transaction_type = 'cancelled'
       )
       AND (
         COALESCE((b.addons->>'loyaltyPointsEarned')::integer, 0) > 0
         OR EXISTS (
           SELECT 1 FROM public.loyalty_transactions lt2
            WHERE lt2.booking_id = b.id
              AND lt2.transaction_type IN ('earned', 'reschedule_adjustment')
         )
       )
  LOOP
    PERFORM public.reverse_booking_loyalty_points(
      r.id,
      format('Backfill: cancelled booking #%s — loyalty points reversed', r.id)
    );
  END LOOP;
END;
$$;
