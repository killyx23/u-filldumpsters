-- When coverage is removed after accept (e.g. reschedule), cancel the plan row
-- instead of rewriting election to decline. Preserve accept history for legal audit.

ALTER TABLE public.booking_protection_plans
  ADD COLUMN IF NOT EXISTS cancellation_reason text NULL;

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
     SET cancelled_at = timezone('utc', now()),
         cancellation_reason = COALESCE(cancellation_reason, 'Booking cancelled')
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
     SET cancelled_at = NULL,
         cancellation_reason = NULL
   WHERE booking_id = p_booking_id
     AND cancelled_at IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

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
  v_cancel_reason text;
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
  v_cancel_reason := COALESCE(
    NULLIF(v_addons->>'protectionCancellationReason', ''),
    'Coverage removed from booking'
  );

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
      protection_plan_id = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.protection_plan_id
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.protection_plan_id
        ELSE EXCLUDED.protection_plan_id
      END,
      plan_name_snapshot = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.plan_name_snapshot
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.plan_name_snapshot
        ELSE EXCLUDED.plan_name_snapshot
      END,
      price_applied = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.price_applied
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.price_applied
        ELSE EXCLUDED.price_applied
      END,
      election = CASE
        WHEN EXCLUDED.election = 'accept' THEN 'accept'
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.election
        ELSE EXCLUDED.election
      END,
      elected_at = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.elected_at
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.elected_at
        ELSE EXCLUDED.elected_at
      END,
      service_id_at_purchase = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.service_id_at_purchase
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.service_id_at_purchase
        ELSE EXCLUDED.service_id_at_purchase
      END,
      cancelled_at = CASE
        WHEN EXCLUDED.election = 'accept' THEN NULL
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
             AND booking_protection_plans.cancelled_at IS NULL
          THEN timezone('utc', now())
        ELSE booking_protection_plans.cancelled_at
      END,
      cancellation_reason = CASE
        WHEN EXCLUDED.election = 'accept' THEN NULL
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
             AND booking_protection_plans.cancelled_at IS NULL
          THEN v_cancel_reason
        ELSE booking_protection_plans.cancellation_reason
      END;
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
      protection_plan_id = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.protection_plan_id
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.protection_plan_id
        ELSE EXCLUDED.protection_plan_id
      END,
      plan_name_snapshot = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.plan_name_snapshot
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.plan_name_snapshot
        ELSE EXCLUDED.plan_name_snapshot
      END,
      price_applied = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.price_applied
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.price_applied
        ELSE EXCLUDED.price_applied
      END,
      election = CASE
        WHEN EXCLUDED.election = 'accept' THEN 'accept'
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.election
        ELSE EXCLUDED.election
      END,
      elected_at = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.elected_at
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.elected_at
        ELSE EXCLUDED.elected_at
      END,
      service_id_at_purchase = CASE
        WHEN EXCLUDED.election = 'accept' THEN EXCLUDED.service_id_at_purchase
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
          THEN booking_protection_plans.service_id_at_purchase
        ELSE EXCLUDED.service_id_at_purchase
      END,
      cancelled_at = CASE
        WHEN EXCLUDED.election = 'accept' THEN NULL
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
             AND booking_protection_plans.cancelled_at IS NULL
          THEN timezone('utc', now())
        ELSE booking_protection_plans.cancelled_at
      END,
      cancellation_reason = CASE
        WHEN EXCLUDED.election = 'accept' THEN NULL
        WHEN booking_protection_plans.election = 'accept'
             AND EXCLUDED.election = 'decline'
             AND booking_protection_plans.cancelled_at IS NULL
          THEN v_cancel_reason
        ELSE booking_protection_plans.cancellation_reason
      END;
  END IF;

  -- If booking is already cancelled, ensure plans are marked cancelled
  IF v_booking.status = 'Cancelled' THEN
    PERFORM public.cancel_booking_protection_plans(p_booking_id);
  END IF;
END;
$$;

-- Backfill: accepted plans still active after insurance/driveway was removed on an approved reschedule
WITH latest_approved AS (
  SELECT
    b.id AS booking_id,
    b.addons,
    (
      SELECT e
      FROM unnest(COALESCE(b.reschedule_history, ARRAY[]::jsonb[])) WITH ORDINALITY AS t(e, ord)
      WHERE e->>'type' = 'reschedule_request'
        AND (
          e->>'status' = 'approved'
          OR e ? 'approved_at'
        )
      ORDER BY ord DESC
      LIMIT 1
    ) AS snap
  FROM public.bookings b
  WHERE b.id = 1307
     OR (
       COALESCE(b.addons->>'insurance', '') = 'accept'
       OR COALESCE(b.addons->>'drivewayProtection', '') = 'accept'
     )
),
parsed AS (
  SELECT
    booking_id,
    addons,
    snap,
    COALESCE(snap->'new_addons', '[]'::jsonb) AS new_addons
  FROM latest_approved
  WHERE snap IS NOT NULL
),
flags AS (
  SELECT
    booking_id,
    addons,
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(new_addons) = 'array' THEN new_addons
          ELSE '[]'::jsonb
        END
      ) a
      WHERE lower(COALESCE(a->>'id', '')) IN ('insurance', 'premium_insurance')
         OR lower(COALESCE(a->>'type', '')) = 'insurance'
         OR lower(COALESCE(a->>'name', '')) LIKE '%insurance%'
    ) AS has_insurance,
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(new_addons) = 'array' THEN new_addons
          ELSE '[]'::jsonb
        END
      ) a
      WHERE lower(COALESCE(a->>'id', '')) IN ('driveway', 'driveway_protection')
         OR lower(COALESCE(a->>'type', '')) IN ('driveway', 'driveway_protection')
         OR lower(COALESCE(a->>'name', '')) LIKE '%driveway%'
    ) AS has_driveway
  FROM parsed
),
updated_bookings AS (
  UPDATE public.bookings b
     SET addons = (
       COALESCE(b.addons, '{}'::jsonb)
       || jsonb_build_object(
            'insurance', CASE WHEN f.has_insurance THEN 'accept' ELSE 'decline' END,
            'drivewayProtection', CASE
              WHEN f.has_driveway THEN 'accept'
              WHEN COALESCE(b.addons->>'drivewayProtection', '') = 'accept' AND NOT f.has_driveway THEN 'decline'
              ELSE COALESCE(b.addons->>'drivewayProtection', 'decline')
            END,
            'insurancePriceApplied', CASE
              WHEN f.has_insurance THEN COALESCE(b.addons->'insurancePriceApplied', '0'::jsonb)
              ELSE '0'::jsonb
            END,
            'drivewayPriceApplied', CASE
              WHEN f.has_driveway THEN COALESCE(b.addons->'drivewayPriceApplied', '0'::jsonb)
              WHEN COALESCE(b.addons->>'drivewayProtection', '') = 'accept' AND NOT f.has_driveway THEN '0'::jsonb
              ELSE COALESCE(b.addons->'drivewayPriceApplied', '0'::jsonb)
            END
          )
       || CASE
            WHEN (COALESCE(b.addons->>'insurance', '') = 'accept' AND NOT f.has_insurance)
              OR (COALESCE(b.addons->>'drivewayProtection', '') = 'accept' AND NOT f.has_driveway)
            THEN jsonb_build_object(
              'protectionCancellationReason', 'Removed during reschedule approval'
            )
            ELSE '{}'::jsonb
          END
     )
  FROM flags f
  WHERE b.id = f.booking_id
    AND (
      (COALESCE(b.addons->>'insurance', '') = 'accept' AND NOT f.has_insurance)
      OR (COALESCE(b.addons->>'drivewayProtection', '') = 'accept' AND NOT f.has_driveway)
      OR b.id = 1307
    )
  RETURNING b.id
)
SELECT public.sync_booking_protection_plans(id) FROM updated_bookings;

-- Ensure #1307 insurance row is cancelled even if addons already declined but plan left accepted
UPDATE public.booking_protection_plans bpp
   SET cancelled_at = COALESCE(bpp.cancelled_at, timezone('utc', now())),
       cancellation_reason = COALESCE(bpp.cancellation_reason, 'Removed during reschedule approval')
 WHERE bpp.booking_id = 1307
   AND bpp.plan_type = 'rental_insurance'
   AND bpp.election = 'accept'
   AND bpp.cancelled_at IS NULL;
