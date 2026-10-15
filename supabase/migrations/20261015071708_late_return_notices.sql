-- Late return: editable flat fee, and one-time notice timestamps.
-- The one-hour lock grace stays internal. Customers are told the scheduled return time.

INSERT INTO public.charges_and_fees (fee_key, fee_name, fee_description, fee_value, is_percentage)
VALUES (
  'late_return_fee',
  'Late Return Fee',
  'Charged when a yard rental is still out one hour after the scheduled return. Edit this any time. Notices use the amount saved at the moment they are sent.',
  75.00,
  false
)
ON CONFLICT (fee_key) DO NOTHING;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS late_return_notice_at timestamptz,
  ADD COLUMN IF NOT EXISTS late_return_algopin_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_to_return_notice_at timestamptz;

COMMENT ON COLUMN public.bookings.late_return_notice_at IS
  'When the missed-return email and text were sent. The grace hour is not mentioned.';
COMMENT ON COLUMN public.bookings.late_return_algopin_at IS
  'When the two-hour return AlgoPIN and second notice were sent.';
COMMENT ON COLUMN public.bookings.failure_to_return_notice_at IS
  'When the failure-to-return charge notice was sent.';

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN ('enforce-late-return-5min')
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'enforce-late-return-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/enforce-late-return',
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
