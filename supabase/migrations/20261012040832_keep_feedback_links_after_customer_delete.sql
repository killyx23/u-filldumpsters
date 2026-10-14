-- Emailed "How can we do better?" links must keep working after the
-- unfinished booking or customer row is removed. Booking links already
-- use ON DELETE SET NULL. Customer links were ON DELETE CASCADE, and
-- unsubscribe also deleted the token rows outright.

ALTER TABLE public.feedback_tokens
  DROP CONSTRAINT IF EXISTS feedback_tokens_customer_id_fkey;

ALTER TABLE public.feedback_tokens
  ADD CONSTRAINT feedback_tokens_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.feedback_responses
  DROP CONSTRAINT IF EXISTS feedback_responses_customer_id_fkey;

ALTER TABLE public.feedback_responses
  ADD CONSTRAINT feedback_responses_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

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
      UPDATE public.pending_customers SET booking_id = NULL WHERE booking_id = v_booking_id;
      UPDATE public.unsubscribe_tokens SET booking_id = NULL WHERE booking_id = v_booking_id;
      IF to_regclass('public.magic_link_tokens') IS NOT NULL THEN
        EXECUTE 'UPDATE public.magic_link_tokens SET order_id = NULL WHERE order_id = $1'
          USING v_booking_id;
      END IF;
      -- Leave feedback_tokens and feedback_responses. Their booking
      -- foreign keys already null out when the booking row goes away.
      BEGIN
        DELETE FROM public.bookings WHERE id = v_booking_id;
        v_deleted_booking := true;
      EXCEPTION WHEN foreign_key_violation THEN
        UPDATE public.bookings
        SET status = 'booking_not_finished',
            addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('equipment_hold_active', false)
        WHERE id = v_booking_id;
        v_deleted_booking := false;
      END;
    END IF;
  END IF;

  DELETE FROM public.pending_customers
  WHERE lower(trim(email)) = v_email;
  GET DIAGNOSTICS v_deleted_pending = ROW_COUNT;

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
