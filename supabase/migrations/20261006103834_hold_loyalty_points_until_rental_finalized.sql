-- Hold loyalty points until an admin finalizes the rental (Completed or flagged).
-- Referral wallet behavior is unchanged.

ALTER TABLE public.loyalty_points
  ADD COLUMN IF NOT EXISTS pending_balance integer NOT NULL DEFAULT 0;

ALTER TABLE public.loyalty_points
  DROP CONSTRAINT IF EXISTS loyalty_points_pending_balance_check;

ALTER TABLE public.loyalty_points
  ADD CONSTRAINT loyalty_points_pending_balance_check CHECK (pending_balance >= 0);

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
      'reschedule_adjustment',
      'pending'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS loyalty_transactions_pending_booking_unique
  ON public.loyalty_transactions (booking_id)
  WHERE transaction_type = 'pending' AND booking_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.release_pending_loyalty_for_booking(
  p_booking_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id bigint;
  v_status text;
  v_net integer := 0;
  v_move integer := 0;
  v_pending_balance integer := 0;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN;
  END IF;

  SELECT b.customer_id, b.status
    INTO v_customer_id, v_status
    FROM public.bookings b
   WHERE b.id = p_booking_id;

  IF v_customer_id IS NULL OR v_status NOT IN ('Completed', 'flagged') THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.loyalty_transactions lt
     WHERE lt.booking_id = p_booking_id
       AND lt.transaction_type IN ('earned', 'cancelled')
  ) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(lt.points_amount), 0)::integer
    INTO v_net
    FROM public.loyalty_transactions lt
   WHERE lt.booking_id = p_booking_id
     AND lt.transaction_type IN ('pending', 'reschedule_adjustment');

  IF v_net <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(lp.pending_balance, 0)
    INTO v_pending_balance
    FROM public.loyalty_points lp
   WHERE lp.customer_id = v_customer_id
   FOR UPDATE;

  v_move := LEAST(v_net, GREATEST(COALESCE(v_pending_balance, 0), 0));
  IF v_move <= 0 THEN
    RETURN;
  END IF;

  UPDATE public.loyalty_points
     SET pending_balance = pending_balance - v_move,
         points_balance = points_balance + v_move,
         last_updated = now()
   WHERE customer_id = v_customer_id;

  INSERT INTO public.loyalty_transactions (
    customer_id,
    transaction_type,
    points_amount,
    booking_id,
    notes
  )
  VALUES (
    v_customer_id,
    'earned',
    v_move,
    p_booking_id,
    format('Loyalty points released after booking #%s was finalized', p_booking_id)
  );
END;
$$;

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
  v_booking_finalized boolean := false;
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

  IF p_booking_id IS NOT NULL THEN
    SELECT b.status IN ('Completed', 'flagged')
      INTO v_booking_finalized
      FROM public.bookings b
     WHERE b.id = p_booking_id;
    v_booking_finalized := COALESCE(v_booking_finalized, false);
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

    IF EXISTS (
      SELECT 1
        FROM public.loyalty_transactions lt
       WHERE lt.booking_id = p_booking_id
         AND lt.transaction_type = 'pending'
    ) THEN
      IF v_booking_finalized THEN
        PERFORM public.release_pending_loyalty_for_booking(p_booking_id);
      END IF;

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
    IF p_booking_id IS NOT NULL AND NOT v_booking_finalized THEN
      UPDATE public.loyalty_points
         SET pending_balance = pending_balance + v_amount,
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
        'pending',
        v_amount,
        p_booking_id,
        p_referral_id,
        COALESCE(p_notes, 'Loyalty points pending until rental is finalized')
      );
    ELSE
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
    END IF;
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
  v_hold integer := 0;
  v_addons jsonb;
  v_released boolean := false;
  v_from_pending boolean := false;
  v_earned_id bigint;
  v_earned_amount integer := 0;
BEGIN
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

  SELECT lt.id, lt.points_amount
    INTO v_earned_id, v_earned_amount
    FROM public.loyalty_transactions lt
   WHERE lt.booking_id = p_booking_id
     AND lt.transaction_type = 'earned'
   ORDER BY lt.id
   LIMIT 1;

  v_released := v_earned_id IS NOT NULL;
  v_from_pending := NOT v_released AND EXISTS (
    SELECT 1
      FROM public.loyalty_transactions lt
     WHERE lt.booking_id = p_booking_id
       AND lt.transaction_type = 'pending'
  );

  IF v_from_pending THEN
    SELECT COALESCE(SUM(lt.points_amount), 0)::integer
      INTO v_earned
      FROM public.loyalty_transactions lt
     WHERE lt.booking_id = p_booking_id
       AND lt.transaction_type IN ('pending', 'reschedule_adjustment');
  ELSIF v_released THEN
    SELECT COALESCE(v_earned_amount, 0) + COALESCE(SUM(lt.points_amount), 0)::integer
      INTO v_earned
      FROM public.loyalty_transactions lt
     WHERE lt.booking_id = p_booking_id
       AND lt.transaction_type = 'reschedule_adjustment'
       AND lt.id > v_earned_id;
  ELSE
    SELECT COALESCE(SUM(
             CASE
               WHEN lt.transaction_type = 'earned' THEN lt.points_amount
               WHEN lt.transaction_type = 'reschedule_adjustment' THEN lt.points_amount
               ELSE 0
             END
           ), 0)::integer
      INTO v_earned
      FROM public.loyalty_transactions lt
     WHERE lt.booking_id = p_booking_id
       AND lt.transaction_type IN ('earned', 'reschedule_adjustment');
  END IF;

  IF v_earned <= 0 THEN
    v_earned := GREATEST(0, COALESCE((v_addons->>'loyaltyPointsEarned')::integer, 0));
    v_from_pending := false;
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

  SELECT lp.points_balance, COALESCE(lp.pending_balance, 0)
    INTO v_balance, v_hold
    FROM public.loyalty_points lp
   WHERE lp.customer_id = v_customer_id
   FOR UPDATE;

  IF v_from_pending THEN
    IF COALESCE(v_hold, 0) < v_earned THEN
      v_earned := GREATEST(0, COALESCE(v_hold, 0));
    END IF;

    IF v_earned > 0 THEN
      UPDATE public.loyalty_points
         SET pending_balance = pending_balance - v_earned,
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
        COALESCE(p_reason, format('Cancelled booking #%s — pending loyalty points reversed', p_booking_id))
      );
    END IF;
  ELSE
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
  v_hold integer := 0;
  v_addons jsonb;
  v_had_loyalty boolean := false;
  v_released boolean := false;
  v_earned_id bigint;
  v_earned_amount integer := 0;
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

  SELECT lt.id, lt.points_amount
    INTO v_earned_id, v_earned_amount
    FROM public.loyalty_transactions lt
   WHERE lt.booking_id = p_booking_id
     AND lt.transaction_type = 'earned'
   ORDER BY lt.id
   LIMIT 1;

  v_released := v_earned_id IS NOT NULL;

  IF v_released THEN
    SELECT COALESCE(v_earned_amount, 0) + COALESCE(SUM(lt.points_amount), 0)::integer
      INTO v_current_net
      FROM public.loyalty_transactions lt
     WHERE lt.booking_id = p_booking_id
       AND lt.transaction_type = 'reschedule_adjustment'
       AND lt.id > v_earned_id;
  ELSE
    SELECT COALESCE(SUM(lt.points_amount), 0)::integer
      INTO v_current_net
      FROM public.loyalty_transactions lt
     WHERE lt.booking_id = p_booking_id
       AND lt.transaction_type IN ('pending', 'reschedule_adjustment');
  END IF;

  v_had_loyalty := (
    v_current_net <> 0
    OR COALESCE((v_addons->>'loyaltyPointsEarned')::integer, 0) > 0
    OR EXISTS (
      SELECT 1 FROM public.loyalty_transactions lt
       WHERE lt.booking_id = p_booking_id
         AND lt.transaction_type IN ('earned', 'pending', 'reschedule_adjustment')
    )
  );

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

  SELECT lp.points_balance, COALESCE(lp.pending_balance, 0)
    INTO v_balance, v_hold
    FROM public.loyalty_points lp
   WHERE lp.customer_id = v_customer_id
   FOR UPDATE;

  IF NOT v_released THEN
    IF v_delta > 0 THEN
      UPDATE public.loyalty_points
         SET pending_balance = pending_balance + v_delta,
             total_points_earned = total_points_earned + v_delta,
             last_updated = now()
       WHERE customer_id = v_customer_id
       RETURNING points_balance INTO v_balance;
    ELSE
      IF COALESCE(v_hold, 0) < abs(v_delta) THEN
        v_delta := -GREATEST(0, COALESCE(v_hold, 0));
      END IF;
      IF v_delta <> 0 THEN
        UPDATE public.loyalty_points
           SET pending_balance = pending_balance + v_delta,
               total_points_earned = GREATEST(0, total_points_earned + v_delta),
               last_updated = now()
         WHERE customer_id = v_customer_id
         RETURNING points_balance INTO v_balance;
      END IF;
    END IF;
  ELSIF v_delta > 0 THEN
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

  IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
    PERFORM public.reverse_booking_loyalty_points(
      NEW.id,
      format('Cancelled booking #%s — loyalty points reversed', NEW.id)
    );
    RETURN NEW;
  END IF;

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

  IF NEW.status IN ('Completed', 'flagged')
     AND OLD.status IS DISTINCT FROM NEW.status
  THEN
    PERFORM public.release_pending_loyalty_for_booking(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.release_pending_loyalty_for_booking(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_pending_loyalty_for_booking(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.reverse_booking_loyalty_points(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_booking_loyalty_to_total(bigint, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_booking_loyalty_points(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_booking_loyalty_to_total(bigint, numeric, text) TO service_role;

-- Move spendable points for rentals that are not yet finalized into pending.
DO $$
DECLARE
  r record;
  v_balance integer;
  v_move integer;
BEGIN
  FOR r IN
    SELECT booking_id, customer_id, net
      FROM (
        SELECT b.id AS booking_id,
               b.customer_id,
               COALESCE(SUM(
                 CASE
                   WHEN lt.transaction_type = 'earned' THEN lt.points_amount
                   WHEN lt.transaction_type = 'reschedule_adjustment' THEN lt.points_amount
                   ELSE 0
                 END
               ), 0)::integer AS net
          FROM public.bookings b
          JOIN public.loyalty_transactions lt ON lt.booking_id = b.id
         WHERE b.status IS DISTINCT FROM 'Completed'
           AND b.status IS DISTINCT FROM 'flagged'
           AND b.status IS DISTINCT FROM 'Cancelled'
           AND NOT EXISTS (
             SELECT 1
               FROM public.loyalty_transactions c
              WHERE c.booking_id = b.id
                AND c.transaction_type = 'cancelled'
           )
           AND EXISTS (
             SELECT 1
               FROM public.loyalty_transactions e
              WHERE e.booking_id = b.id
                AND e.transaction_type = 'earned'
           )
         GROUP BY b.id, b.customer_id
      ) nets
     WHERE net > 0
     ORDER BY booking_id
  LOOP
    SELECT COALESCE(lp.points_balance, 0)
      INTO v_balance
      FROM public.loyalty_points lp
     WHERE lp.customer_id = r.customer_id
     FOR UPDATE;

    v_move := LEAST(r.net, GREATEST(COALESCE(v_balance, 0), 0));
    IF v_move <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.loyalty_points
       SET points_balance = points_balance - v_move,
           pending_balance = pending_balance + v_move,
           last_updated = now()
     WHERE customer_id = r.customer_id;

    UPDATE public.loyalty_transactions
       SET transaction_type = 'pending'
     WHERE booking_id = r.booking_id
       AND transaction_type = 'earned';
  END LOOP;
END;
$$;
