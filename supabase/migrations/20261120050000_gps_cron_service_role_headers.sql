-- GPS cron must send a real JWT in Authorization and apikey.
-- Local vault used to hold sb_secret_ (not a JWT); Kong then drops JWT auth
-- and the functions runtime returns 401 Missing authorization header.
-- Production vault already stores the service_role JWT. This only adds the
-- Kong apikey header and skips the POST when vault is empty.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.invoke_sync_gps_trackers()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, extensions, vault
AS $$
DECLARE
  base_url text;
  service_key text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret INTO base_url
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key';

  IF base_url IS NULL OR length(trim(base_url)) < 8 THEN
    RAISE WARNING 'invoke_sync_gps_trackers: vault supabase_url is missing';
    RETURN NULL;
  END IF;
  IF service_key IS NULL OR length(trim(service_key)) < 16 THEN
    RAISE WARNING 'invoke_sync_gps_trackers: vault service_role_key is missing';
    RETURN NULL;
  END IF;
  -- Kong JWT plugin needs a real JWT (eyJ...), not sb_secret_.
  IF left(service_key, 3) <> 'eyJ' THEN
    RAISE WARNING 'invoke_sync_gps_trackers: service_role_key is not a JWT; refusing to POST';
    RETURN NULL;
  END IF;

  IF right(base_url, 1) = '/' THEN
    base_url := left(base_url, length(base_url) - 1);
  END IF;

  SELECT net.http_post(
    url := base_url || '/functions/v1/sync-gps-trackers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.invoke_sync_gps_trackers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.invoke_sync_gps_trackers() TO postgres, supabase_admin;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN ('sync-gps-trackers-2min', 'sync-gps-trackers-5min')
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'sync-gps-trackers-5min',
  '*/5 * * * *',
  $$SELECT private.invoke_sync_gps_trackers();$$
);

COMMENT ON FUNCTION private.invoke_sync_gps_trackers() IS
  'pg_cron helper: POST sync-gps-trackers with vault service_role JWT. Never logs the token. Token is not sent to yzxgps.';
