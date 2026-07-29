-- Mark booking protection plans cancelled when the parent booking is cancelled.
-- Preserves election history (accept/decline); coverage ends via cancelled_at.

ALTER TABLE public.booking_protection_plans
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_booking_protection_plans_cancelled_at
  ON public.booking_protection_plans (cancelled_at)
  WHERE cancelled_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cancel_booking_protection_plans(p_booking_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.booking_protection_plans
     SET cancelled_at = timezone('utc', now())
   WHERE booking_id = p_booking_id
     AND cancelled_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reactivate_booking_protection_plans(p_booking_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.booking_protection_plans
     SET cancelled_at = NULL
   WHERE booking_id = p_booking_id
     AND cancelled_at IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.bookings_protection_cancel_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
    PERFORM public.cancel_booking_protection_plans(NEW.id);
  ELSIF OLD.status = 'Cancelled' AND NEW.status IS DISTINCT FROM 'Cancelled' THEN
    PERFORM public.reactivate_booking_protection_plans(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_protection_cancel ON public.bookings;
CREATE TRIGGER trg_bookings_protection_cancel
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_protection_cancel_trigger();

REVOKE ALL ON FUNCTION public.cancel_booking_protection_plans(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reactivate_booking_protection_plans(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking_protection_plans(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.reactivate_booking_protection_plans(bigint) TO service_role;

-- Preserve cancelled_at on sync upserts (explicitly keep existing value)
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
      service_id_at_purchase = EXCLUDED.service_id_at_purchase,
      cancelled_at = booking_protection_plans.cancelled_at;
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
      service_id_at_purchase = EXCLUDED.service_id_at_purchase,
      cancelled_at = booking_protection_plans.cancelled_at;
  END IF;

  -- If booking is already cancelled, ensure plans are marked cancelled
  IF v_booking.status = 'Cancelled' THEN
    PERFORM public.cancel_booking_protection_plans(p_booking_id);
  END IF;
END;
$$;

-- Backfill cancelled bookings (including #1300 / #1301)
UPDATE public.booking_protection_plans bpp
   SET cancelled_at = COALESCE(bpp.cancelled_at, timezone('utc', now()))
  FROM public.bookings b
 WHERE bpp.booking_id = b.id
   AND b.status = 'Cancelled'
   AND bpp.cancelled_at IS NULL;
