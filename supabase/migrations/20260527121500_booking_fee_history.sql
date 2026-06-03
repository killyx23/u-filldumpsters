-- Historical record of agreement-time fee values (snapshot) and applied charge events.

CREATE TABLE IF NOT EXISTS public.booking_fee_snapshots (
    id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    fee_key TEXT NOT NULL,
    fee_name TEXT NOT NULL,
    fee_description TEXT,
    fee_value NUMERIC(10, 2) NOT NULL,
    is_percentage BOOLEAN DEFAULT FALSE,
    snapshot_source TEXT DEFAULT 'agreement_step6_acceptance',
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS booking_fee_snapshots_booking_id_idx
    ON public.booking_fee_snapshots(booking_id);

CREATE INDEX IF NOT EXISTS booking_fee_snapshots_fee_key_idx
    ON public.booking_fee_snapshots(fee_key);

CREATE TABLE IF NOT EXISTS public.booking_charge_transactions (
    id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    charge_key TEXT NOT NULL,
    charge_name TEXT NOT NULL,
    charge_description TEXT,
    charge_amount NUMERIC(10, 2) NOT NULL,
    charge_source TEXT DEFAULT 'admin_manual',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS booking_charge_transactions_booking_id_idx
    ON public.booking_charge_transactions(booking_id);

CREATE INDEX IF NOT EXISTS booking_charge_transactions_charge_key_idx
    ON public.booking_charge_transactions(charge_key);

ALTER TABLE public.booking_fee_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_charge_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access booking_fee_snapshots" ON public.booking_fee_snapshots;
CREATE POLICY "Admin full access booking_fee_snapshots"
  ON public.booking_fee_snapshots FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Customers read own booking_fee_snapshots" ON public.booking_fee_snapshots;
CREATE POLICY "Customers read own booking_fee_snapshots"
  ON public.booking_fee_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = booking_id
        AND b.customer_id = public.current_customer_id()
    )
  );

DROP POLICY IF EXISTS "Admin full access booking_charge_transactions" ON public.booking_charge_transactions;
CREATE POLICY "Admin full access booking_charge_transactions"
  ON public.booking_charge_transactions FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Customers read own booking_charge_transactions" ON public.booking_charge_transactions;
CREATE POLICY "Customers read own booking_charge_transactions"
  ON public.booking_charge_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.id = booking_id
        AND b.customer_id = public.current_customer_id()
    )
  );

GRANT SELECT ON public.booking_fee_snapshots TO authenticated;
GRANT SELECT ON public.booking_charge_transactions TO authenticated;
GRANT ALL ON public.booking_fee_snapshots TO service_role;
GRANT ALL ON public.booking_charge_transactions TO service_role;

CREATE OR REPLACE FUNCTION public.create_pending_booking(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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

  IF jsonb_typeof(payload->'addons'->'agreementFeeSnapshot') = 'array' THEN
    INSERT INTO public.booking_fee_snapshots (
      booking_id,
      fee_key,
      fee_name,
      fee_description,
      fee_value,
      is_percentage,
      snapshot_source,
      captured_at
    )
    SELECT
      new_id,
      COALESCE(item->>'fee_key', 'unknown_fee_key'),
      COALESCE(item->>'fee_name', item->>'fee_key', 'Unknown Fee'),
      item->>'fee_description',
      COALESCE(NULLIF(item->>'fee_value', '')::numeric, 0),
      COALESCE((item->>'is_percentage')::boolean, false),
      COALESCE(item->>'source', 'agreement_step6_acceptance'),
      COALESCE((item->>'captured_at')::timestamptz, NOW())
    FROM jsonb_array_elements(payload->'addons'->'agreementFeeSnapshot') AS item;
  END IF;

  RETURN jsonb_build_object(
    'id', new_id,
    'customer_id', new_customer_id
  );
END;
$$;
