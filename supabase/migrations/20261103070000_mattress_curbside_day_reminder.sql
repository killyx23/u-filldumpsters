-- Day-of SMS reminder when a delivery booking includes mattress disposal.
-- Mattresses must stay out of the dumpster and at the curb for separate haul-off.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS mattress_curbside_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.mattress_curbside_reminder_sent_at IS
  'When the day-of curbside mattress disposal SMS was sent (delivery + mattressDisposal only).';

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN ('send-mattress-day-reminder-5min')
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'send-mattress-day-reminder-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/send-mattress-day-reminder',
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
