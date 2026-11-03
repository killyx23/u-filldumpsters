-- Idle/completion polls were still redirecting new checkouts to old confirmations.
--
-- Root cause: get_checkout_completion_status used find_converted_checkout_sibling,
-- which matches any overlapping paid booking created at/after pending.created_at.
-- A reused pending row that has not been rewritten yet (or is polled in a race
-- before store_pending_booking bumps created_at) still looks "completed".
--
-- Fix: only treat a checkout as completed when pending.booking_id points at a
-- converted booking (create_pending_booking always sets that link on pay).
-- Also return booking_created_at so the browser can freshness-check without
-- selecting from bookings (anon has no SELECT policy on bookings).

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
  v_booking_created_at timestamptz;
  v_email text;
  v_verified boolean;
  v_progress jsonb;
BEGIN
  IF p_pending_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_id_required');
  END IF;

  SELECT id, email, booking_id, drop_off_date, pickup_date, is_verified, verified_at, created_at
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
    'verified_at', p.verified_at,
    'pending_created_at', p.created_at
  );

  IF p.booking_id IS NOT NULL THEN
    SELECT status, created_at
      INTO v_status, v_booking_created_at
      FROM public.bookings
     WHERE id = p.booking_id;

    IF FOUND AND public.booking_status_is_converted(v_status) THEN
      RETURN v_progress || jsonb_build_object(
        'ok', true,
        'completed', true,
        'booking_id', p.booking_id,
        'booking_created_at', v_booking_created_at,
        'status', v_status,
        'reason', 'linked_booking'
      );
    END IF;
  END IF;

  RETURN v_progress || jsonb_build_object(
    'ok', true,
    'completed', false,
    'booking_id', p.booking_id,
    'booking_created_at', null,
    'status', v_status
  );
END;
$$;

COMMENT ON FUNCTION public.get_checkout_completion_status(uuid) IS
  'Checkout progress for a pending id. completed=true only when pending.booking_id is a converted booking; includes booking_created_at for client freshness checks.';

GRANT EXECUTE ON FUNCTION public.get_checkout_completion_status(uuid)
  TO anon, authenticated, service_role;
