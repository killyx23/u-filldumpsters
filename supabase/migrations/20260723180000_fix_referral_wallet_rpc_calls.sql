-- Fix register/activate referral RPCs: remove redundant AS t(...) column lists
-- that Postgres 17 rejects for functions with OUT parameters.
-- Also qualify wallet UPDATE columns (OUT params collide with column names)
-- and write referralDollarsActivated onto booking.addons when activation succeeds.

CREATE OR REPLACE FUNCTION public.adjust_referral_wallet(
  p_customer_id bigint,
  p_amount numeric,
  p_transaction_type text,
  p_booking_id bigint DEFAULT NULL,
  p_referral_id bigint DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS TABLE(already_processed boolean, pending_balance numeric, available_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric(10,2);
  v_wallet public.customer_referral_wallets%ROWTYPE;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id is required';
  END IF;

  v_amount := round(abs(COALESCE(p_amount, 0)), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid wallet amount';
  END IF;

  INSERT INTO public.customer_referral_wallets (customer_id)
  VALUES (p_customer_id)
  ON CONFLICT (customer_id) DO NOTHING;

  SELECT *
    INTO v_wallet
    FROM public.customer_referral_wallets
   WHERE customer_id = p_customer_id
   FOR UPDATE;

  IF p_referral_id IS NOT NULL
     AND p_transaction_type IN ('pending_accrual', 'activated')
     AND EXISTS (
       SELECT 1
         FROM public.referral_wallet_transactions t
        WHERE t.referral_id = p_referral_id
          AND t.transaction_type = p_transaction_type
     )
  THEN
    already_processed := true;
    pending_balance := COALESCE(v_wallet.pending_balance, 0);
    available_balance := COALESCE(v_wallet.available_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_booking_id IS NOT NULL
     AND p_transaction_type = 'redeemed'
     AND EXISTS (
       SELECT 1
         FROM public.referral_wallet_transactions t
        WHERE t.customer_id = p_customer_id
          AND t.booking_id = p_booking_id
          AND t.transaction_type = 'redeemed'
     )
  THEN
    already_processed := true;
    pending_balance := COALESCE(v_wallet.pending_balance, 0);
    available_balance := COALESCE(v_wallet.available_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_transaction_type = 'pending_accrual' THEN
    UPDATE public.customer_referral_wallets w
       SET pending_balance = COALESCE(w.pending_balance, 0) + v_amount,
           total_earned = COALESCE(w.total_earned, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSIF p_transaction_type = 'activated' THEN
    IF COALESCE(v_wallet.pending_balance, 0) < v_amount THEN
      RAISE EXCEPTION 'Insufficient pending referral balance';
    END IF;
    UPDATE public.customer_referral_wallets w
       SET pending_balance = COALESCE(w.pending_balance, 0) - v_amount,
           available_balance = COALESCE(w.available_balance, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSIF p_transaction_type = 'redeemed' THEN
    IF COALESCE(v_wallet.available_balance, 0) < v_amount THEN
      RAISE EXCEPTION 'Insufficient referral dollars';
    END IF;
    UPDATE public.customer_referral_wallets w
       SET available_balance = COALESCE(w.available_balance, 0) - v_amount,
           total_redeemed = COALESCE(w.total_redeemed, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSIF p_transaction_type = 'admin_adjustment_add' THEN
    UPDATE public.customer_referral_wallets w
       SET available_balance = COALESCE(w.available_balance, 0) + v_amount,
           total_earned = COALESCE(w.total_earned, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSIF p_transaction_type = 'admin_adjustment_remove' THEN
    IF COALESCE(v_wallet.available_balance, 0) < v_amount THEN
      RAISE EXCEPTION 'Insufficient referral dollars';
    END IF;
    UPDATE public.customer_referral_wallets w
       SET available_balance = COALESCE(w.available_balance, 0) - v_amount,
           total_redeemed = COALESCE(w.total_redeemed, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSIF p_transaction_type = 'expired' THEN
    UPDATE public.customer_referral_wallets w
       SET available_balance = GREATEST(0, COALESCE(w.available_balance, 0) - v_amount),
           pending_balance = GREATEST(
             0,
             COALESCE(w.pending_balance, 0) - GREATEST(0, v_amount - COALESCE(w.available_balance, 0))
           ),
           total_redeemed = COALESCE(w.total_redeemed, 0) + v_amount,
           last_updated = now()
     WHERE w.customer_id = p_customer_id
     RETURNING w.* INTO v_wallet;
  ELSE
    RAISE EXCEPTION 'Unsupported transaction type: %', p_transaction_type;
  END IF;

  INSERT INTO public.referral_wallet_transactions (
    customer_id,
    referral_id,
    booking_id,
    transaction_type,
    amount,
    pending_balance_after,
    available_balance_after,
    notes
  ) VALUES (
    p_customer_id,
    p_referral_id,
    p_booking_id,
    p_transaction_type,
    v_amount,
    COALESCE(v_wallet.pending_balance, 0),
    COALESCE(v_wallet.available_balance, 0),
    p_notes
  );

  already_processed := false;
  pending_balance := COALESCE(v_wallet.pending_balance, 0);
  available_balance := COALESCE(v_wallet.available_balance, 0);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_referral_for_booking(
  p_booking_id bigint,
  p_referee_customer_id bigint,
  p_referral_code text,
  p_bonus_dollars numeric DEFAULT NULL
)
RETURNS TABLE(
  referral_id bigint,
  pending_recorded boolean,
  already_rewarded boolean,
  blocked_duplicate boolean,
  referrer_customer_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_bonus numeric(10,2);
  v_wallet_result record;
BEGIN
  IF p_booking_id IS NULL OR p_referee_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(trim(p_referral_code), '') = '' THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_referral
    FROM public.referrals r
   WHERE lower(r.referral_code) = lower(trim(p_referral_code))
   ORDER BY r.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  referral_id := v_referral.id;
  referrer_customer_id := v_referral.referrer_customer_id;

  IF v_referral.referrer_customer_id = p_referee_customer_id THEN
    blocked_duplicate := true;
    pending_recorded := false;
    already_rewarded := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.referrals r
     WHERE r.referee_customer_id = p_referee_customer_id
       AND r.id <> v_referral.id
       AND r.status IN ('pending_completion', 'pending_activation', 'completed', 'rewarded')
  ) THEN
    blocked_duplicate := true;
    pending_recorded := false;
    already_rewarded := false;
    RETURN NEXT;
    RETURN;
  END IF;

  v_bonus := round(COALESCE(p_bonus_dollars, (
    SELECT ls.referral_bonus_dollars
      FROM public.loyalty_settings ls
     ORDER BY ls.id DESC
     LIMIT 1
  ), 25), 2);

  UPDATE public.referrals
     SET referee_customer_id = COALESCE(referee_customer_id, p_referee_customer_id),
         pending_booking_id = COALESCE(pending_booking_id, p_booking_id),
         status = CASE
           WHEN status = 'rewarded' THEN status
           ELSE 'pending_completion'
         END
   WHERE id = v_referral.id
   RETURNING * INTO v_referral;

  already_rewarded := v_referral.status = 'rewarded';
  blocked_duplicate := false;
  pending_recorded := false;

  IF NOT already_rewarded AND v_bonus > 0 THEN
    SELECT *
      INTO v_wallet_result
      FROM public.adjust_referral_wallet(
        v_referral.referrer_customer_id,
        v_bonus,
        'pending_accrual',
        p_booking_id,
        v_referral.id,
        'Referral pending until booking #' || p_booking_id::text || ' reaches Completed'
      );

    pending_recorded := NOT COALESCE(v_wallet_result.already_processed, false);

    UPDATE public.referrals
       SET referrer_bonus_dollars_awarded = GREATEST(COALESCE(referrer_bonus_dollars_awarded, 0), v_bonus)
     WHERE id = v_referral.id;
  END IF;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_referral_for_completed_booking(
  p_booking_id bigint
)
RETURNS TABLE(
  referral_id bigint,
  activated boolean,
  bonus_dollars numeric,
  referrer_customer_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_referral public.referrals%ROWTYPE;
  v_bonus numeric(10,2);
  v_wallet_result record;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN;
  END IF;

  SELECT b.id, b.customer_id, b.status
    INTO v_booking
    FROM public.bookings b
   WHERE b.id = p_booking_id
   LIMIT 1;

  IF NOT FOUND OR v_booking.customer_id IS NULL THEN
    RETURN;
  END IF;

  IF lower(COALESCE(v_booking.status, '')) <> 'completed' THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_referral
    FROM public.referrals r
   WHERE r.pending_booking_id = p_booking_id
     AND r.referee_customer_id = v_booking.customer_id
   ORDER BY r.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  referral_id := v_referral.id;
  referrer_customer_id := v_referral.referrer_customer_id;

  v_bonus := round(COALESCE(v_referral.referrer_bonus_dollars_awarded, 0), 2);
  IF v_bonus <= 0 THEN
    v_bonus := round(COALESCE((
      SELECT ls.referral_bonus_dollars
        FROM public.loyalty_settings ls
       ORDER BY ls.id DESC
       LIMIT 1
    ), 25), 2);
  END IF;

  bonus_dollars := v_bonus;

  IF v_referral.status = 'rewarded' AND v_referral.reward_activated_at IS NOT NULL THEN
    activated := false;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.referrals
     SET status = CASE WHEN v_bonus > 0 THEN 'rewarded' ELSE 'completed' END,
         completed_booking_id = COALESCE(completed_booking_id, p_booking_id),
         pending_booking_id = COALESCE(pending_booking_id, p_booking_id),
         completed_at = COALESCE(completed_at, now())
   WHERE id = v_referral.id;

  IF v_bonus > 0 THEN
    SELECT *
      INTO v_wallet_result
      FROM public.adjust_referral_wallet(
        v_referral.referrer_customer_id,
        v_bonus,
        'activated',
        p_booking_id,
        v_referral.id,
        'Referral activated after booking #' || p_booking_id::text || ' completed'
      );

    activated := NOT COALESCE(v_wallet_result.already_processed, false);

    IF activated THEN
      UPDATE public.referrals
         SET reward_activated_at = now(),
             referrer_bonus_dollars_awarded = v_bonus
       WHERE id = v_referral.id;

      UPDATE public.bookings
         SET addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object(
           'referralDollarsActivated', v_bonus,
           'referralDollarsPending', 0
         )
       WHERE id = p_booking_id;
    END IF;
  ELSE
    activated := false;
  END IF;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_referral_wallet(bigint, numeric, text, bigint, bigint, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_referral_for_booking(bigint, bigint, text, numeric)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_referral_for_completed_booking(bigint)
  TO anon, authenticated, service_role;
