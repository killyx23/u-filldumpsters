-- Consolidate generate-daily-pins (4x-daily) + ensure-lock-pin-ready (5m) into
-- a single reconcile-lock-pins sweeper that runs every 5 minutes.
--
-- reconcile-lock-pins does everything both old functions did (delete stale
-- PINs, create missing ones, confirm pending bridge jobs, escalate to
-- AlgoPIN, alert admins) in one pass, and is also invoked on demand by
-- igloohome-webhook when a bridge reconnects — so the 4x-daily coarse sweep
-- is no longer needed as a separate job.
--
-- Idempotent: safe to re-run.

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
  'reconcile-lock-pins-5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/reconcile-lock-pins',
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
    body := jsonb_build_object('reason', 'cron')
  );
  $$
);
