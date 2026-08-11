-- Fail-safe PIN readiness: confirmation columns + 5-minute ensure-lock-pin-ready sweeper.
-- Idempotent: safe if 20260805090000 was never applied.

ALTER TABLE public.rental_access_codes
  ADD COLUMN IF NOT EXISTS lock_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS rental_access_codes_status_confirmed_idx
  ON public.rental_access_codes (status, lock_confirmed_at);

-- Treat existing active PINs as confirmed so we do not re-issue them.
UPDATE public.rental_access_codes
SET lock_confirmed_at = COALESCE(created_at, now())
WHERE status = 'active'
  AND lock_confirmed_at IS NULL;

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
      'ensure-lock-pin-ready-15m',
      'ensure-lock-pin-ready-5m'
    )
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

-- Primary T-12h sweeper: create / confirm / AlgoPIN backup every 5 minutes.
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
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
