-- ROLLBACK for 20260826120000_consolidate_pin_reconciler_cron.sql
--
-- Restores the previous two cron jobs and unschedules reconcile-lock-pins-5m.
-- Does not delete the reconcile-lock-pins function — leave it deployed but idle.
-- Old functions generate-daily-pins and ensure-lock-pin-ready stay in place.
--
-- Run against the target database only when you need to jump ship:
--   psql "$DATABASE_URL" -f supabase/rollback/20260826120000_restore_pin_crons.sql
--
-- After this, redeploy is not required if those two functions are still live.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN (
      'generate-daily-pins-hourly',
      'generate-daily-pins-4x-daily',
      'ensure-lock-pin-ready-15m',
      'ensure-lock-pin-ready-5m',
      'reconcile-lock-pins-5m'
    )
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
      ),
      'apikey', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'ensure-lock-pin-ready-5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/ensure-lock-pin-ready',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
      ),
      'apikey', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
