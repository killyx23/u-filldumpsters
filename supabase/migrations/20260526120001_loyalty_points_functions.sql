-- Loyalty RPC functions used by finalize-booking and loyalty-points edge functions.

ALTER TABLE public.loyalty_settings
  ADD COLUMN IF NOT EXISTS referral_bonus_points integer NOT NULL DEFAULT 100;

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

GRANT EXECUTE ON FUNCTION public.adjust_loyalty_points(bigint, integer, text, bigint, bigint, text)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.admin_adjust_loyalty_points(bigint, integer, text)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.complete_referral_for_booking(bigint, bigint, text, integer)
  TO anon, authenticated, service_role;
