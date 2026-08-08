-- Reschedule pg_cron edge-function jobs to read the project URL from Vault
-- instead of a hardcoded production URL.
--
-- PREREQUISITE (manual, not in migration):
--   vault.secrets must contain 'supabase_url' (project API URL, no trailing slash).

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
      'sync-lock-activity-5min',
      'ensure-lock-pin-ready-15m'
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
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'sync-lock-activity-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/sync-lock-activity',
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

SELECT cron.schedule(
  'ensure-lock-pin-ready-15m',
  '*/15 * * * *',
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
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
