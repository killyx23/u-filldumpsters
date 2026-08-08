-- Persist checkout verification docs (including insurance) into the canonical
-- driver_verification_documents table via SECURITY DEFINER, so anon payment
-- flow is not blocked by RLS.

DROP FUNCTION IF EXISTS public.update_customer_license_from_checkout(bigint, text, jsonb);

CREATE OR REPLACE FUNCTION public.update_customer_license_from_checkout(
  p_booking_id bigint,
  p_license_plate text,
  p_license_image_urls jsonb,
  p_insurance_image jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id bigint;
  v_front_url text;
  v_front_path text;
  v_back_url text;
  v_back_path text;
  v_insurance_url text;
  v_insurance_path text;
  v_status text;
  v_has_any_doc boolean;
BEGIN
  SELECT b.customer_id
  INTO v_customer_id
  FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.status = 'pending_payment';

  IF v_customer_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.customers c
  SET
    license_plate = COALESCE(p_license_plate, c.license_plate),
    license_image_urls = COALESCE(p_license_image_urls, c.license_image_urls)
  WHERE c.id = v_customer_id;

  v_front_url := p_license_image_urls->0->>'url';
  v_front_path := p_license_image_urls->0->>'path';
  v_back_url := p_license_image_urls->1->>'url';
  v_back_path := p_license_image_urls->1->>'path';
  v_insurance_url := p_insurance_image->>'url';
  v_insurance_path := p_insurance_image->>'path';

  v_has_any_doc :=
    COALESCE(v_front_url, v_front_path) IS NOT NULL
    OR COALESCE(v_back_url, v_back_path) IS NOT NULL
    OR COALESCE(v_insurance_url, v_insurance_path) IS NOT NULL;

  -- Nothing to write into the canonical table
  IF NOT v_has_any_doc THEN
    RETURN;
  END IF;

  -- Checkout never auto-approves; admin must review.
  v_status := 'pending';

  INSERT INTO public.driver_verification_documents AS d (
    customer_id,
    license_front_url,
    license_front_storage_path,
    license_back_url,
    license_back_storage_path,
    insurance_url,
    insurance_storage_path,
    uploaded_at,
    verification_status
  )
  VALUES (
    v_customer_id,
    v_front_url,
    v_front_path,
    v_back_url,
    v_back_path,
    v_insurance_url,
    v_insurance_path,
    now(),
    v_status
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    license_front_url = COALESCE(EXCLUDED.license_front_url, d.license_front_url),
    license_front_storage_path = COALESCE(EXCLUDED.license_front_storage_path, d.license_front_storage_path),
    license_back_url = COALESCE(EXCLUDED.license_back_url, d.license_back_url),
    license_back_storage_path = COALESCE(EXCLUDED.license_back_storage_path, d.license_back_storage_path),
    insurance_url = COALESCE(EXCLUDED.insurance_url, d.insurance_url),
    insurance_storage_path = COALESCE(EXCLUDED.insurance_storage_path, d.insurance_storage_path),
    uploaded_at = now(),
    verification_status = CASE
      WHEN d.verification_status = 'approved' THEN d.verification_status
      ELSE EXCLUDED.verification_status
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_customer_license_from_checkout(bigint, text, jsonb, jsonb)
  TO anon, authenticated, service_role;
