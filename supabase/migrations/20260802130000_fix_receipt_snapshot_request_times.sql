-- Fix receipt_original_snapshot.captured_at when it was stamped with approval time
-- instead of the customer reschedule request time.

WITH candidates AS (
  SELECT
    b.id AS booking_id,
    b.receipt_original_snapshot,
    (
      SELECT e->>'at'
      FROM jsonb_array_elements(COALESCE(b.receipt_status_history, '[]'::jsonb)) e
      WHERE e->>'action' = 'reschedule_approved'
      ORDER BY e->>'at' DESC NULLS LAST
      LIMIT 1
    ) AS approved_at,
    (
      SELECT COALESCE(e->>'requested_at', e->>'approved_at')
      FROM unnest(COALESCE(b.reschedule_history, ARRAY[]::jsonb[])) WITH ORDINALITY AS t(e, ord)
      WHERE e->>'type' = 'reschedule_request'
      ORDER BY ord DESC
      LIMIT 1
    ) AS requested_at,
    (
      SELECT l.reschedule_request_time::text
      FROM public.reschedule_history_logs l
      WHERE l.booking_id = b.id
        AND l.request_type = 'reschedule'
      ORDER BY l.reschedule_request_time DESC NULLS LAST
      LIMIT 1
    ) AS log_requested_at
  FROM public.bookings b
  WHERE b.receipt_original_snapshot IS NOT NULL
),
fixed AS (
  SELECT
    booking_id,
    receipt_original_snapshot,
    COALESCE(requested_at, log_requested_at) AS true_requested_at,
    approved_at
  FROM candidates
  WHERE COALESCE(requested_at, log_requested_at) IS NOT NULL
    AND (
      approved_at IS NOT NULL
      AND receipt_original_snapshot->>'captured_at' IS NOT DISTINCT FROM approved_at
    )
)
UPDATE public.bookings b
   SET receipt_original_snapshot =
     COALESCE(b.receipt_original_snapshot, '{}'::jsonb)
     || jsonb_build_object('captured_at', f.true_requested_at)
  FROM fixed f
 WHERE b.id = f.booking_id;
