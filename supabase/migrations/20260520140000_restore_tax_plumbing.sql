-- Re-apply tax plumbing dropped by 20260519155036_remote_schema.sql
-- (delivery_type, tax_rate_cache, business_settings rates, pending_customers subtotal)

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS delivery_type text,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction text,
  ADD COLUMN IF NOT EXISTS tax_zip_used text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_delivery_type_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_delivery_type_check
      CHECK (delivery_type = ANY (ARRAY['delivery'::text, 'self_service_trailer'::text, 'self_pickup'::text]));
  END IF;
END $$;

COMMENT ON COLUMN public.bookings.delivery_type IS 'Delivery mode: delivery, self_service_trailer, or self_pickup';
COMMENT ON COLUMN public.bookings.tax_jurisdiction IS 'Tax jurisdiction label applied at booking time';
COMMENT ON COLUMN public.bookings.tax_zip_used IS 'ZIP code used for tax rate lookup';

ALTER TABLE public.pending_customers
  ADD COLUMN IF NOT EXISTS subtotal_before_tax numeric;

ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS tax_rate_pickup numeric DEFAULT 7.45,
  ADD COLUMN IF NOT EXISTS tax_rate_delivery numeric DEFAULT 7.45;

COMMENT ON COLUMN public.business_settings.tax_rate_pickup IS 'Sales tax rate (%) for self-pickup at business location';
COMMENT ON COLUMN public.business_settings.tax_rate_delivery IS 'Sales tax rate (%) fallback for delivery transactions';

CREATE TABLE IF NOT EXISTS public.tax_rate_cache (
  zip_code text NOT NULL PRIMARY KEY,
  rate numeric NOT NULL,
  jurisdiction text,
  state_rate numeric,
  county_rate numeric,
  city_rate numeric,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tax_rate_cache IS 'Cache of ZIP-code sales tax rates from TaxJar. TTL enforced by lookup-tax-rate (30 days).';
COMMENT ON COLUMN public.tax_rate_cache.rate IS 'Combined state+county+city rate as percentage (e.g. 7.45)';

ALTER TABLE public.tax_rate_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tax_rate_cache' AND policyname = 'service_role_full_access'
  ) THEN
    CREATE POLICY service_role_full_access ON public.tax_rate_cache
      TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.tax_records
  ADD COLUMN IF NOT EXISTS delivery_type text,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction text,
  ADD COLUMN IF NOT EXISTS tax_api_used text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tax_records_delivery_type_check'
  ) THEN
    ALTER TABLE public.tax_records
      ADD CONSTRAINT tax_records_delivery_type_check
      CHECK (delivery_type = ANY (ARRAY['delivery'::text, 'self_service_trailer'::text, 'self_pickup'::text]));
  END IF;
END $$;

COMMENT ON COLUMN public.tax_records.delivery_type IS 'Delivery mode at booking time';
COMMENT ON COLUMN public.tax_records.tax_api_used IS 'Source of tax rate: business_settings, taxjar, cache, fallback';

-- create_pending_booking: include delivery_type (supersedes restore_tax_flags version)
CREATE OR REPLACE FUNCTION public.create_pending_booking(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  new_id bigint;
  new_customer_id bigint;
BEGIN
  INSERT INTO bookings (
    name,
    first_name,
    last_name,
    email,
    phone,
    street,
    city,
    state,
    zip,
    contact_address,
    delivery_address,
    drop_off_date,
    pickup_date,
    drop_off_time_slot,
    pickup_time_slot,
    plan,
    addons,
    total_price,
    subtotal_before_tax,
    tax_amount,
    tax_rate_used,
    delivery_type,
    status,
    notes,
    was_verification_skipped,
    verification_notes
  )
  VALUES (
    payload->>'name',
    payload->>'first_name',
    payload->>'last_name',
    payload->>'email',
    payload->>'phone',
    payload->>'street',
    payload->>'city',
    payload->>'state',
    payload->>'zip',
    payload->'contact_address',
    payload->'delivery_address',
    (payload->>'drop_off_date')::date,
    (payload->>'pickup_date')::date,
    payload->>'drop_off_time_slot',
    payload->>'pickup_time_slot',
    payload->'plan',
    payload->'addons',
    (payload->>'total_price')::real,
    COALESCE((payload->>'subtotal_before_tax')::numeric, 0),
    COALESCE((payload->>'tax_amount')::numeric, 0),
    COALESCE((payload->>'tax_rate_used')::numeric, 0),
    payload->>'delivery_type',
    'pending_payment',
    payload->>'notes',
    COALESCE((payload->>'was_verification_skipped')::boolean, false),
    payload->>'verification_notes'
  )
  RETURNING id, customer_id INTO new_id, new_customer_id;

  RETURN jsonb_build_object(
    'id', new_id,
    'customer_id', new_customer_id
  );
END;
$$;
