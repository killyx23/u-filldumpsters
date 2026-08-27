-- Fix feedback token RNG: pgcrypto lives in extensions schema
CREATE OR REPLACE FUNCTION public.create_early_leave_feedback_token(p_booking_id bigint)
RETURNS TABLE (
  token text,
  customer_id bigint,
  email text,
  first_name text,
  site_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  b record;
  v_token text;
  v_expires timestamptz := timezone('utc', now()) + interval '30 days';
BEGIN
  SELECT
    bk.id,
    bk.customer_id,
    bk.email,
    bk.first_name,
    bk.name,
    bk.status
  INTO b
  FROM public.bookings bk
  WHERE bk.id = p_booking_id;

  IF b.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF b.customer_id IS NULL THEN
    RAISE EXCEPTION 'Booking has no customer';
  END IF;

  IF b.email IS NULL OR length(trim(b.email)) = 0 THEN
    RAISE EXCEPTION 'Booking has no email';
  END IF;

  PERFORM public.mark_customer_feedback_lead(b.customer_id);

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  INSERT INTO public.feedback_tokens (token, customer_id, booking_id, expires_at)
  VALUES (v_token, b.customer_id, b.id, v_expires);

  token := v_token;
  customer_id := b.customer_id;
  email := b.email;
  first_name := COALESCE(NULLIF(trim(b.first_name), ''), split_part(COALESCE(b.name, 'there'), ' ', 1), 'there');
  site_path := '/how-can-we-do-better?token=' || v_token;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_early_leave_feedback_token(bigint) TO service_role;
