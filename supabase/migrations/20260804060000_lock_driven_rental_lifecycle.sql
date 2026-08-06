-- Lock-driven rental lifecycle support:
--   * Idempotency columns for rental-started / return notification emails+SMS
--   * Customer SMS opt-in tracking (terms already collect consent)
--   * Deduping unique index on rental_tracking_logs
--   * pg_cron job to poll Igloohome activity logs every 5 minutes

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS rental_started_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_notified_at timestamptz;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS sms_opt_in boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_opt_out_at timestamptz;

COMMENT ON COLUMN public.bookings.rental_started_notified_at IS
  'When the rental-started email/SMS was sent after first unlock.';
COMMENT ON COLUMN public.bookings.return_notified_at IS
  'When the return thank-you email/SMS was sent after final lock.';
COMMENT ON COLUMN public.customers.sms_opt_in IS
  'Customer consent for transactional SMS. Defaults true; set false on STOP.';
COMMENT ON COLUMN public.customers.sms_opt_out_at IS
  'Timestamp when the customer opted out of SMS (e.g. replied STOP).';

-- Deduplicate lock/unlock events that arrive via both webhook and poll
CREATE UNIQUE INDEX IF NOT EXISTS rental_tracking_logs_order_event_ts_uidx
  ON public.rental_tracking_logs (order_id, event_type, event_timestamp);

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN ('sync-lock-activity-5min')
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

-- Every 5 minutes. Requires vault secret 'service_role_key' (same as generate-daily-pins).
SELECT cron.schedule(
  'sync-lock-activity-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://REDACTED_PROJECT_REF.supabase.co/functions/v1/sync-lock-activity',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
