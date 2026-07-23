-- Checkout-safe read for driver verification documents (anon booking flow).

CREATE OR REPLACE FUNCTION public.get_checkout_verification_documents(
  p_customer_id bigint,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_customer record;
  v_doc record;
  v_legacy_front text;
  v_legacy_back text;
  v_legacy_front_path text;
  v_legacy_back_path text;
  v_result jsonb;
BEGIN
  v_email := lower(trim(p_email));
  IF v_email IS NULL OR v_email = '' OR p_customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, email, license_plate, license_image_urls
  INTO v_customer
  FROM public.customers
  WHERE id = p_customer_id
    AND lower(email) = v_email;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_doc
  FROM public.driver_verification_documents
  WHERE customer_id = p_customer_id;

  IF jsonb_typeof(v_customer.license_image_urls) = 'array' AND jsonb_array_length(v_customer.license_image_urls) > 0 THEN
    v_legacy_front := v_customer.license_image_urls->0->>'url';
    v_legacy_front_path := v_customer.license_image_urls->0->>'path';
  END IF;

  IF jsonb_typeof(v_customer.license_image_urls) = 'array' AND jsonb_array_length(v_customer.license_image_urls) > 1 THEN
    v_legacy_back := v_customer.license_image_urls->1->>'url';
    v_legacy_back_path := v_customer.license_image_urls->1->>'path';
  END IF;

  v_result := jsonb_build_object(
    'customer_id', p_customer_id,
    'license_plate', v_customer.license_plate,
    'license_front_url', COALESCE(v_doc.license_front_url, v_legacy_front),
    'license_front_storage_path', COALESCE(v_doc.license_front_storage_path, v_legacy_front_path),
    'license_back_url', COALESCE(v_doc.license_back_url, v_legacy_back),
    'license_back_storage_path', COALESCE(v_doc.license_back_storage_path, v_legacy_back_path),
    'insurance_url', v_doc.insurance_url,
    'insurance_storage_path', v_doc.insurance_storage_path,
    'verification_status', COALESCE(v_doc.verification_status, CASE WHEN v_legacy_front IS NOT NULL THEN 'legacy' ELSE NULL END)
  );

  IF (v_result->>'license_front_url') IS NULL
     AND (v_result->>'license_back_url') IS NULL
     AND (v_result->>'insurance_url') IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_checkout_verification_documents(bigint, text) TO anon, authenticated, service_role;
