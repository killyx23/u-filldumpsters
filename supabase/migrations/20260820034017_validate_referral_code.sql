-- Allow booking flow to validate referral codes before checkout (anon-safe RPC).
CREATE OR REPLACE FUNCTION public.validate_referral_code(
  p_referral_code text,
  p_referee_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_referee_email text;
  v_referrer_email text;
BEGIN
  IF COALESCE(trim(p_referral_code), '') = '' THEN
    RETURN jsonb_build_object(
      'isValid', false,
      'error', 'Please enter a referral code.'
    );
  END IF;

  SELECT *
    INTO v_referral
    FROM public.referrals r
   WHERE lower(r.referral_code) = lower(trim(p_referral_code))
   ORDER BY r.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'isValid', false,
      'error', 'This referral code was not found.'
    );
  END IF;

  IF v_referral.status IN ('rewarded', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object(
      'isValid', false,
      'error', 'This referral code is no longer active.'
    );
  END IF;

  IF v_referral.referee_customer_id IS NOT NULL OR v_referral.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'isValid', false,
      'error', 'This referral code has already been used.'
    );
  END IF;

  v_referee_email := lower(trim(COALESCE(p_referee_email, '')));
  IF v_referee_email <> '' THEN
    SELECT lower(trim(c.email))
      INTO v_referrer_email
      FROM public.customers c
     WHERE c.id = v_referral.referrer_customer_id;

    IF v_referrer_email IS NOT NULL AND v_referrer_email = v_referee_email THEN
      RETURN jsonb_build_object(
        'isValid', false,
        'error', 'You cannot use your own referral code.'
      );
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.customers c
        JOIN public.referrals r ON r.referee_customer_id = c.id
       WHERE lower(trim(c.email)) = v_referee_email
         AND r.id <> v_referral.id
         AND r.status IN ('pending_completion', 'pending_activation', 'completed', 'rewarded')
    ) THEN
      RETURN jsonb_build_object(
        'isValid', false,
        'error', 'This email has already been referred.'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'isValid', true,
    'code', v_referral.referral_code,
    'referralId', v_referral.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_referral_code(text, text)
  TO anon, authenticated, service_role;
