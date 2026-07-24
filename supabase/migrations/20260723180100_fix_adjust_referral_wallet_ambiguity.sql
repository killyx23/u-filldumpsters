-- Local DBs that already applied 20260723180000 still have the ambiguous
-- pending_balance / available_balance UPDATE bug in adjust_referral_wallet.
-- Re-apply the fixed function body (idempotent CREATE OR REPLACE).

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

GRANT EXECUTE ON FUNCTION public.adjust_referral_wallet(bigint, numeric, text, bigint, bigint, text)
  TO anon, authenticated, service_role;
