-- email_verified for checkout progress must be pending-row only.
-- Falling back to email_verifications.is_verified (lifetime, by email) caused
-- new checkouts to look "already verified" and skip OTP / false stand-down.

CREATE OR REPLACE FUNCTION public.get_checkout_completion_status(p_pending_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  v_status text;
  v_converted_id bigint;
  v_email text;
  v_verified boolean;
  v_progress jsonb;
BEGIN
  IF p_pending_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_id_required');
  END IF;

  SELECT id, email, booking_id, drop_off_date, pickup_date, is_verified, verified_at
    INTO p
    FROM public.pending_customers
   WHERE id = p_pending_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_not_found', 'completed', false);
  END IF;

  v_email := lower(trim(COALESCE(p.email, '')));
  v_verified := COALESCE(p.is_verified, false);

  v_progress := jsonb_build_object(
    'email', v_email,
    'email_verified', v_verified,
    'verified_at', p.verified_at
  );

  IF p.booking_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.bookings WHERE id = p.booking_id;
    IF FOUND AND public.booking_status_is_converted(v_status) THEN
      RETURN v_progress || jsonb_build_object(
        'ok', true,
        'completed', true,
        'booking_id', p.booking_id,
        'status', v_status,
        'reason', 'linked_booking'
      );
    END IF;
  END IF;

  v_converted_id := public.find_converted_checkout_sibling(
    p.email,
    p.booking_id,
    p.drop_off_date,
    p.pickup_date
  );

  IF v_converted_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.bookings WHERE id = v_converted_id;
    RETURN v_progress || jsonb_build_object(
      'ok', true,
      'completed', true,
      'booking_id', v_converted_id,
      'status', v_status,
      'reason', 'sibling_converted'
    );
  END IF;

  RETURN v_progress || jsonb_build_object(
    'ok', true,
    'completed', false,
    'booking_id', p.booking_id,
    'status', v_status
  );
END;
$$;

COMMENT ON FUNCTION public.get_checkout_completion_status(uuid) IS
  'Checkout progress for a pending id: completed/booking_id plus email_verified from pending_customers.is_verified only (not lifetime email_verifications).';

GRANT EXECUTE ON FUNCTION public.get_checkout_completion_status(uuid)
  TO anon, authenticated, service_role;
