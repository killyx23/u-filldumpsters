-- Protection plans: rental insurance, driveway protection, and future plan types.
-- Replaces services id 7 + business_settings driveway_protection_price as pricing sources.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS is_rentable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.services.is_rentable IS
  'False for legacy non-rental rows (e.g. Premium Insurance service id 7).';

CREATE TABLE IF NOT EXISTS public.protection_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text NOT NULL UNIQUE,
  plan_type text NOT NULL CHECK (plan_type IN ('rental_insurance', 'driveway_protection')),
  name text NOT NULL,
  description text,
  price numeric(10, 2) NOT NULL DEFAULT 0,
  price_unit text DEFAULT '/rental',
  is_taxable boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  info_text text,
  legacy_service_id integer REFERENCES public.services(id) ON DELETE SET NULL,
  legacy_equipment_id bigint REFERENCES public.equipment(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.protection_plan_services (
  id bigserial PRIMARY KEY,
  protection_plan_id uuid NOT NULL REFERENCES public.protection_plans(id) ON DELETE CASCADE,
  service_id integer NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  UNIQUE (protection_plan_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.booking_protection_plans (
  id bigserial PRIMARY KEY,
  booking_id bigint NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id bigint REFERENCES public.customers(id) ON DELETE SET NULL,
  protection_plan_id uuid REFERENCES public.protection_plans(id) ON DELETE SET NULL,
  plan_type text NOT NULL,
  plan_name_snapshot text NOT NULL,
  price_applied numeric(10, 2) NOT NULL DEFAULT 0,
  election text NOT NULL CHECK (election IN ('accept', 'decline')),
  elected_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  service_id_at_purchase integer REFERENCES public.services(id) ON DELETE SET NULL,
  UNIQUE (booking_id, plan_type)
);

CREATE TABLE IF NOT EXISTS public.protection_plan_claims (
  id bigserial PRIMARY KEY,
  booking_protection_plan_id bigint NOT NULL REFERENCES public.booking_protection_plans(id) ON DELETE CASCADE,
  booking_id bigint NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id bigint REFERENCES public.customers(id) ON DELETE SET NULL,
  claim_date date NOT NULL DEFAULT CURRENT_DATE,
  claim_amount numeric(10, 2) NOT NULL DEFAULT 0,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'paid')),
  admin_notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_protection_plans_type_active
  ON public.protection_plans (plan_type, is_active);

CREATE INDEX IF NOT EXISTS idx_protection_plan_services_service
  ON public.protection_plan_services (service_id);

CREATE INDEX IF NOT EXISTS idx_booking_protection_plans_booking
  ON public.booking_protection_plans (booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_protection_plans_customer
  ON public.booking_protection_plans (customer_id);

CREATE INDEX IF NOT EXISTS idx_protection_plan_claims_booking
  ON public.protection_plan_claims (booking_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.protection_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protection_plan_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_protection_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protection_plan_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active protection_plans" ON public.protection_plans;
CREATE POLICY "Public read active protection_plans"
  ON public.protection_plans FOR SELECT
  USING (is_active = true OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin write protection_plans" ON public.protection_plans;
CREATE POLICY "Admin write protection_plans"
  ON public.protection_plans FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Public read protection_plan_services" ON public.protection_plan_services;
CREATE POLICY "Public read protection_plan_services"
  ON public.protection_plan_services FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write protection_plan_services" ON public.protection_plan_services;
CREATE POLICY "Admin write protection_plan_services"
  ON public.protection_plan_services FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Customers read own booking_protection_plans" ON public.booking_protection_plans;
CREATE POLICY "Customers read own booking_protection_plans"
  ON public.booking_protection_plans FOR SELECT
  USING (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Service role write booking_protection_plans" ON public.booking_protection_plans;
CREATE POLICY "Service role write booking_protection_plans"
  ON public.booking_protection_plans FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin full access protection_plan_claims" ON public.protection_plan_claims;
CREATE POLICY "Admin full access protection_plan_claims"
  ON public.protection_plan_claims FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

GRANT SELECT ON public.protection_plans TO anon, authenticated;
GRANT SELECT ON public.protection_plan_services TO anon, authenticated;
GRANT SELECT ON public.booking_protection_plans TO authenticated;
GRANT ALL ON public.protection_plans TO service_role;
GRANT ALL ON public.protection_plan_services TO service_role;
GRANT ALL ON public.booking_protection_plans TO service_role;
GRANT ALL ON public.protection_plan_claims TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.booking_protection_plans_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.protection_plan_claims_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.protection_plan_services_id_seq TO service_role;

-- ---------------------------------------------------------------------------
-- Seed protection plans from legacy sources
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_insurance_price numeric(10, 2) := 25.00;
  v_insurance_name text := 'Premium Insurance';
  v_insurance_desc text := 'Complete protection coverage for your rental';
  v_insurance_taxable boolean := false;
  v_driveway_price numeric(10, 2) := 15.00;
  v_driveway_taxable boolean := true;
  v_premium_id uuid;
  v_driveway_id uuid;
  v_equip record;
  -- Service 7 is catalog data from seed.sql. On a fresh `db reset` it does not exist yet,
  -- so hardcoding legacy_service_id = 7 violates protection_plans_legacy_service_id_fkey.
  v_legacy_service_id integer;
BEGIN
  SELECT base_price, name, description, is_taxable, id
  INTO v_insurance_price, v_insurance_name, v_insurance_desc, v_insurance_taxable, v_legacy_service_id
  FROM public.services
  WHERE id = 7;

  IF v_insurance_price IS NULL THEN
    v_insurance_price := 25.00;
  END IF;

  SELECT
    COALESCE((setting_value->>'price')::numeric, 15.00),
    COALESCE((setting_value->>'is_taxable')::boolean, true)
  INTO v_driveway_price, v_driveway_taxable
  FROM public.business_settings
  WHERE setting_key = 'driveway_protection_price'
  LIMIT 1;

  IF v_driveway_price IS NULL THEN
    v_driveway_price := 15.00;
    v_driveway_taxable := true;
  END IF;

  INSERT INTO public.protection_plans (
    plan_key, plan_type, name, description, price, price_unit,
    is_taxable, is_primary, is_active, display_order, legacy_service_id
  ) VALUES (
    'premium_insurance', 'rental_insurance',
    COALESCE(v_insurance_name, 'Premium Insurance'),
    COALESCE(v_insurance_desc, 'Complete protection coverage for your rental'),
    v_insurance_price, '/rental',
    COALESCE(v_insurance_taxable, false), true, true, 1, v_legacy_service_id
  )
  ON CONFLICT (plan_key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price = EXCLUDED.price,
    is_taxable = EXCLUDED.is_taxable,
    legacy_service_id = EXCLUDED.legacy_service_id,
    updated_at = timezone('utc', now())
  RETURNING id INTO v_premium_id;

  IF v_premium_id IS NULL THEN
    SELECT id INTO v_premium_id FROM public.protection_plans WHERE plan_key = 'premium_insurance';
  END IF;

  INSERT INTO public.protection_plans (
    plan_key, plan_type, name, description, price, price_unit,
    is_taxable, is_primary, is_active, display_order,
    info_text
  ) VALUES (
    'driveway_protection', 'driveway_protection',
    'Driveway Protection',
    'Protects your driveway during delivery and pickup.',
    v_driveway_price, '/delivery',
    v_driveway_taxable, true, true, 2,
    'Driveway protection prevents damage to your property during delivery.'
  )
  ON CONFLICT (plan_key) DO UPDATE SET
    price = EXCLUDED.price,
    is_taxable = EXCLUDED.is_taxable,
    updated_at = timezone('utc', now())
  RETURNING id INTO v_driveway_id;

  IF v_driveway_id IS NULL THEN
    SELECT id INTO v_driveway_id FROM public.protection_plans WHERE plan_key = 'driveway_protection';
  END IF;

  -- Premium insurance: all rentable services (ids 1-5)
  INSERT INTO public.protection_plan_services (protection_plan_id, service_id)
  SELECT v_premium_id, s.id
  FROM public.services s
  WHERE s.is_rentable = true AND s.id <> 7
  ON CONFLICT (protection_plan_id, service_id) DO NOTHING;

  -- Driveway: delivery-applicable services (16 yard dumpster + dump loader with delivery)
  INSERT INTO public.protection_plan_services (protection_plan_id, service_id)
  SELECT v_driveway_id, s.id
  FROM public.services s
  WHERE s.id IN (1, 4)
  ON CONFLICT (protection_plan_id, service_id) DO NOTHING;

  -- Legacy equipment insurance rows (non-premium)
  FOR v_equip IN
    SELECT * FROM public.equipment
    WHERE type = 'insurance'
      AND id <> 7
      AND lower(name) NOT LIKE '%premium%'
  LOOP
    INSERT INTO public.protection_plans (
      plan_key, plan_type, name, description, price, price_unit,
      is_taxable, is_primary, is_active, display_order, legacy_equipment_id
    ) VALUES (
      'legacy_insurance_' || v_equip.id::text,
      'rental_insurance',
      v_equip.name,
      v_equip.description,
      COALESCE(v_equip.price, 0),
      '/rental',
      false,
      false,
      false,
      100 + v_equip.id::integer,
      v_equip.id
    )
    ON CONFLICT (plan_key) DO NOTHING;

    IF v_equip.service_id_association IS NOT NULL THEN
      INSERT INTO public.protection_plan_services (protection_plan_id, service_id)
      SELECT pp.id, v_equip.service_id_association
      FROM public.protection_plans pp
      WHERE pp.legacy_equipment_id = v_equip.id
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  UPDATE public.services SET is_rentable = false WHERE id = 7;
END $$;

-- ---------------------------------------------------------------------------
-- Sync helper: upsert booking_protection_plans from bookings.addons JSON
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_booking_protection_plans(p_booking_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_booking record;
  v_addons jsonb;
  v_service_id integer;
  v_elected_at timestamptz;
  v_insurance_plan record;
  v_driveway_plan record;
  v_insurance_plan_id uuid;
  v_driveway_plan_id uuid;
BEGIN
  SELECT b.*, COALESCE((b.plan->>'id')::integer, NULL) AS plan_service_id
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_addons := COALESCE(v_booking.addons, '{}'::jsonb);
  v_service_id := v_booking.plan_service_id;
  v_elected_at := COALESCE(v_booking.created_at, timezone('utc', now()));

  -- Resolve plan IDs from addons snapshot or lookup by service
  v_insurance_plan_id := NULLIF(v_addons->'protectionPlanIds'->>'rentalInsurance', '')::uuid;
  v_driveway_plan_id := NULLIF(v_addons->'protectionPlanIds'->>'drivewayProtection', '')::uuid;

  IF v_insurance_plan_id IS NULL AND v_service_id IS NOT NULL THEN
    SELECT pp.* INTO v_insurance_plan
    FROM public.protection_plans pp
    INNER JOIN public.protection_plan_services pps ON pps.protection_plan_id = pp.id
    WHERE pp.plan_type = 'rental_insurance'
      AND pp.is_active = true
      AND pps.service_id = v_service_id
    ORDER BY pp.is_primary DESC, pp.display_order ASC
    LIMIT 1;
    v_insurance_plan_id := v_insurance_plan.id;
  ELSIF v_insurance_plan_id IS NOT NULL THEN
    SELECT * INTO v_insurance_plan FROM public.protection_plans WHERE id = v_insurance_plan_id;
  ELSE
    SELECT * INTO v_insurance_plan
    FROM public.protection_plans
    WHERE plan_key = 'premium_insurance'
    LIMIT 1;
    v_insurance_plan_id := v_insurance_plan.id;
  END IF;

  IF v_driveway_plan_id IS NULL AND v_service_id IS NOT NULL THEN
    SELECT pp.* INTO v_driveway_plan
    FROM public.protection_plans pp
    INNER JOIN public.protection_plan_services pps ON pps.protection_plan_id = pp.id
    WHERE pp.plan_type = 'driveway_protection'
      AND pp.is_active = true
      AND pps.service_id = v_service_id
    ORDER BY pp.is_primary DESC, pp.display_order ASC
    LIMIT 1;
    v_driveway_plan_id := v_driveway_plan.id;
  ELSIF v_driveway_plan_id IS NOT NULL THEN
    SELECT * INTO v_driveway_plan FROM public.protection_plans WHERE id = v_driveway_plan_id;
  ELSE
    SELECT * INTO v_driveway_plan
    FROM public.protection_plans
    WHERE plan_key = 'driveway_protection'
    LIMIT 1;
    v_driveway_plan_id := v_driveway_plan.id;
  END IF;

  IF v_insurance_plan_id IS NOT NULL AND v_addons ? 'insurance' THEN
    INSERT INTO public.booking_protection_plans (
      booking_id, customer_id, protection_plan_id, plan_type,
      plan_name_snapshot, price_applied, election, elected_at, service_id_at_purchase
    ) VALUES (
      p_booking_id,
      v_booking.customer_id,
      v_insurance_plan_id,
      'rental_insurance',
      COALESCE(v_insurance_plan.name, 'Premium Insurance'),
      CASE
        WHEN COALESCE(v_addons->>'insurance', 'decline') = 'accept'
        THEN COALESCE(
          NULLIF(v_addons->>'insurancePriceApplied', '')::numeric,
          v_insurance_plan.price,
          0
        )
        ELSE 0
      END,
      COALESCE(v_addons->>'insurance', 'decline'),
      v_elected_at,
      v_service_id
    )
    ON CONFLICT (booking_id, plan_type) DO UPDATE SET
      protection_plan_id = EXCLUDED.protection_plan_id,
      plan_name_snapshot = EXCLUDED.plan_name_snapshot,
      price_applied = EXCLUDED.price_applied,
      election = EXCLUDED.election,
      elected_at = EXCLUDED.elected_at,
      service_id_at_purchase = EXCLUDED.service_id_at_purchase;
  END IF;

  IF v_driveway_plan_id IS NOT NULL AND v_addons ? 'drivewayProtection' THEN
    INSERT INTO public.booking_protection_plans (
      booking_id, customer_id, protection_plan_id, plan_type,
      plan_name_snapshot, price_applied, election, elected_at, service_id_at_purchase
    ) VALUES (
      p_booking_id,
      v_booking.customer_id,
      v_driveway_plan_id,
      'driveway_protection',
      COALESCE(v_driveway_plan.name, 'Driveway Protection'),
      CASE
        WHEN COALESCE(v_addons->>'drivewayProtection', 'decline') = 'accept'
        THEN COALESCE(
          NULLIF(v_addons->>'drivewayPriceApplied', '')::numeric,
          v_driveway_plan.price,
          0
        )
        ELSE 0
      END,
      COALESCE(v_addons->>'drivewayProtection', 'decline'),
      v_elected_at,
      v_service_id
    )
    ON CONFLICT (booking_id, plan_type) DO UPDATE SET
      protection_plan_id = EXCLUDED.protection_plan_id,
      plan_name_snapshot = EXCLUDED.plan_name_snapshot,
      price_applied = EXCLUDED.price_applied,
      election = EXCLUDED.election,
      elected_at = EXCLUDED.elected_at,
      service_id_at_purchase = EXCLUDED.service_id_at_purchase;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_booking_protection_plans(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_booking_protection_plans(bigint) TO service_role;

-- Backfill historical bookings
DO $$
DECLARE
  v_booking_id bigint;
BEGIN
  FOR v_booking_id IN
    SELECT id FROM public.bookings
    WHERE addons IS NOT NULL
      AND (
        addons ? 'insurance'
        OR addons ? 'drivewayProtection'
      )
  LOOP
    PERFORM public.sync_booking_protection_plans(v_booking_id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Extend create_pending_booking to sync protection plan records
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_pending_booking(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
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

  PERFORM public.sync_booking_protection_plans(new_id);

  RETURN jsonb_build_object(
    'id', new_id,
    'customer_id', new_customer_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pending_booking(jsonb) TO anon, authenticated, service_role;

-- Re-sync when booking addons change (reschedule approval, admin edits)
CREATE OR REPLACE FUNCTION public.trigger_sync_booking_protection_plans()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.addons IS DISTINCT FROM OLD.addons THEN
    PERFORM public.sync_booking_protection_plans(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_sync_protection_plans ON public.bookings;
CREATE TRIGGER bookings_sync_protection_plans
  AFTER INSERT OR UPDATE OF addons ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_booking_protection_plans();
