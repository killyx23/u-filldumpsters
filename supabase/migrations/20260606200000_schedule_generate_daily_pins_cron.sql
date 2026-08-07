-- Schedule generate-daily-pins edge function via pg_cron + pg_net.
--
-- PREREQUISITE (manual, not in migration):
--   vault.secrets must contain:
--     * 'service_role_key' — project service role JWT
--     * 'supabase_url' — project API URL (e.g. https://<ref>.supabase.co, no trailing slash)
--   The cron job reads both via vault.decrypted_secrets.
--
-- Runs 4x daily at midnight, 6am, noon, and 6pm Mountain (MST = UTC+6):
--   12:00 AM MST -> 06:00 UTC
--    6:00 AM MST -> 12:00 UTC
--   12:00 PM MST -> 18:00 UTC
--    6:00 PM MST -> 00:00 UTC

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN ('generate-daily-pins-hourly', 'generate-daily-pins-4x-daily')
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'generate-daily-pins-4x-daily',
  '0 0,6,12,18 * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/generate-daily-pins',
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
