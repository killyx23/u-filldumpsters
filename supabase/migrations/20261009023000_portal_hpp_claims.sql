-- Portal Hardware Protection Plan claims: notice time, source, and a customer-safe submit function.
-- proof_photos is required by the submit function. Add it here too so a database that
-- skipped the earlier claim-photo migration can still store portal claim pictures.

ALTER TABLE public.protection_plan_claims
  ADD COLUMN IF NOT EXISTS proof_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS coverage_cap numeric(10, 2),
  ADD COLUMN IF NOT EXISTS covered_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS customer_charge_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS amount_charged numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charge_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text,
  ADD COLUMN IF NOT EXISTS charged_at timestamptz,
  ADD COLUMN IF NOT EXISTS notice_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_via text NOT NULL DEFAULT 'admin';

ALTER TABLE public.protection_plan_claims
  DROP CONSTRAINT IF EXISTS protection_plan_claims_submitted_via_check;

ALTER TABLE public.protection_plan_claims
  ADD CONSTRAINT protection_plan_claims_submitted_via_check
  CHECK (submitted_via IN ('portal', 'admin'));

CREATE OR REPLACE FUNCTION public.submit_portal_hardware_claim(
  p_booking_id bigint,
  p_subject text,
  p_description text,
  p_photos jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id bigint;
  v_plan_id bigint;
  v_notice timestamptz := timezone('utc', now());
  v_note_id bigint;
  v_claim_id bigint;
  v_hpp boolean := false;
  v_photos jsonb := '[]'::jsonb;
  v_photo jsonb;
  v_path text;
  v_prefix text;
  v_content text;
  v_photo_list text;
BEGIN
  v_customer_id := public.current_customer_id();
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in as a customer';
  END IF;

  IF p_booking_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.bookings
    WHERE id = p_booking_id
      AND customer_id = v_customer_id
  ) THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF coalesce(trim(p_description), '') = '' THEN
    RAISE EXCEPTION 'Description is required';
  END IF;

  v_prefix := v_customer_id::text || '/protection-claims/';
  IF p_photos IS NOT NULL AND jsonb_typeof(p_photos) = 'array' THEN
    IF jsonb_array_length(p_photos) > 8 THEN
      RAISE EXCEPTION 'No more than 8 photos';
    END IF;
    FOR v_photo IN SELECT value FROM jsonb_array_elements(p_photos)
    LOOP
      v_path := v_photo->>'path';
      IF v_path IS NULL OR left(v_path, length(v_prefix)) <> v_prefix THEN
        RAISE EXCEPTION 'Invalid photo path';
      END IF;
      v_photos := v_photos || jsonb_build_array(
        jsonb_build_object('path', v_path, 'name', coalesce(v_photo->>'name', 'photo'))
      );
    END LOOP;
  END IF;

  IF jsonb_array_length(v_photos) < 1 THEN
    RAISE EXCEPTION 'At least one photo is required';
  END IF;

  SELECT id INTO v_plan_id
  FROM public.booking_protection_plans
  WHERE booking_id = p_booking_id
    AND customer_id = v_customer_id
    AND plan_type = 'rental_insurance'
    AND election = 'accept'
    AND cancelled_at IS NULL
  LIMIT 1;

  v_hpp := v_plan_id IS NOT NULL;

  IF v_hpp THEN
    INSERT INTO public.protection_plan_claims (
      booking_protection_plan_id,
      booking_id,
      customer_id,
      claim_date,
      claim_amount,
      description,
      status,
      proof_photos,
      notice_submitted_at,
      submitted_via
    ) VALUES (
      v_plan_id,
      p_booking_id,
      v_customer_id,
      (v_notice AT TIME ZONE 'utc')::date,
      0,
      trim(p_description),
      'open',
      v_photos,
      v_notice,
      'portal'
    )
    RETURNING id INTO v_claim_id;
  END IF;

  SELECT coalesce(string_agg(photo->>'path', '|'), '')
  INTO v_photo_list
  FROM jsonb_array_elements(v_photos) photo;

  v_content :=
    '**TICKET:** ' || coalesce(nullif(trim(p_subject), ''), 'Hardware damage claim') || E'\n' ||
    '**HPP_CLAIM:** ' || CASE WHEN v_hpp THEN 'accepted' ELSE 'not_enrolled' END || E'\n' ||
    '**BOOKING:** ' || p_booking_id::text || E'\n' ||
    '**NOTICE_AT:** ' || to_char(v_notice, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || E'\n' ||
    '**CLAIM_ID:** ' || coalesce(v_claim_id::text, 'none') || E'\n' ||
    '**PHOTOS:** ' || v_photo_list || E'\n\n' ||
    trim(p_description);

  INSERT INTO public.customer_notes (
    customer_id,
    booking_id,
    source,
    content,
    author_type,
    is_read
  ) VALUES (
    v_customer_id,
    p_booking_id,
    'Support Ticket',
    v_content,
    'customer',
    false
  )
  RETURNING id INTO v_note_id;

  RETURN jsonb_build_object(
    'note_id', v_note_id,
    'claim_id', v_claim_id,
    'hpp_accepted', v_hpp,
    'notice_submitted_at', v_notice,
    'content', v_content
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_portal_hardware_claim(bigint, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_portal_hardware_claim(bigint, text, text, jsonb) TO authenticated;
