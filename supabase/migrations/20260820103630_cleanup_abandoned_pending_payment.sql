-- Cancel abandoned unpaid checkout bookings and restock equipment holds.
-- Covers both new holds (addons.equipment_hold_active) and legacy pending_payment rows.

CREATE OR REPLACE FUNCTION public.cleanup_abandoned_pending_payment_bookings(
  p_older_than interval DEFAULT interval '2 hours'
)
RETURNS TABLE(
  booking_id bigint,
  restocked boolean,
  cancelled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  eq jsonb;
  items jsonb := '[]'::jsonb;
  item jsonb;
  eq_id bigint;
  qty int;
  should_restock boolean;
  did_restock boolean;
BEGIN
  FOR rec IN
    SELECT b.id, b.status, b.addons, b.created_at, b.total_price
    FROM public.bookings b
    WHERE b.status = 'pending_payment'
      AND b.created_at < now() - p_older_than
    ORDER BY b.id
  LOOP
    items := '[]'::jsonb;
    should_restock := false;
    did_restock := false;

    IF rec.addons IS NOT NULL
       AND jsonb_typeof(rec.addons->'equipment') = 'array'
       AND jsonb_array_length(rec.addons->'equipment') > 0
    THEN
      -- Skip if already explicitly released
      IF COALESCE(rec.addons->>'equipment_hold_active', '') IS DISTINCT FROM 'false' THEN
        should_restock := true;
      END IF;

      IF should_restock THEN
        FOR eq IN SELECT * FROM jsonb_array_elements(rec.addons->'equipment')
        LOOP
          eq_id := NULLIF(COALESCE(eq->>'dbId', eq->>'equipment_id', eq->>'id'), '')::bigint;
          qty := COALESCE(NULLIF(eq->>'quantity', '')::int, 1);
          IF eq_id IS NOT NULL AND qty > 0 THEN
            items := items || jsonb_build_array(
              jsonb_build_object('equipment_id', eq_id, 'quantity', qty)
            );
          END IF;
        END LOOP;

        IF jsonb_array_length(items) > 0 THEN
          PERFORM public.increment_equipment_quantities(items);
          did_restock := true;
        END IF;
      END IF;
    END IF;

    UPDATE public.bookings
    SET
      status = 'Cancelled',
      addons = COALESCE(addons, '{}'::jsonb) || jsonb_build_object('equipment_hold_active', false),
      archive_details = jsonb_build_object(
        'action', 'cancelled',
        'action_at', now(),
        'initiated_by', 'system',
        'notes', 'abandoned_checkout_timeout',
        'original_created_at', rec.created_at,
        'original_total_price', rec.total_price
      )
    WHERE id = rec.id
      AND status = 'pending_payment';

    booking_id := rec.id;
    restocked := did_restock;
    cancelled := FOUND;
    RETURN NEXT;
  END LOOP;
END;
$$;

ALTER FUNCTION public.cleanup_abandoned_pending_payment_bookings(interval) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.cleanup_abandoned_pending_payment_bookings(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_pending_payment_bookings(interval) TO service_role;

COMMENT ON FUNCTION public.cleanup_abandoned_pending_payment_bookings(interval) IS
  'Cancels pending_payment bookings older than the given interval and restocks any unpaid equipment holds.';

-- Run every 15 minutes
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname = 'cleanup-abandoned-pending-payment'
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'cleanup-abandoned-pending-payment',
  '*/15 * * * *',
  $$SELECT public.cleanup_abandoned_pending_payment_bookings(interval '2 hours');$$
);
