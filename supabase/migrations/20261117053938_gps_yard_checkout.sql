-- GPS trackers are the rental clock when a unit leaves or re-enters a yard.
-- The padlock still logs every event and sets the clock only when the tracker
-- has no fresh GPS fix.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS checkout_clock_source text,
  ADD COLUMN IF NOT EXISTS return_clock_source text;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_checkout_clock_source_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_checkout_clock_source_check
  CHECK (checkout_clock_source IS NULL OR checkout_clock_source = ANY (ARRAY['gps'::text, 'lock'::text, 'manual'::text]));

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_return_clock_source_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_return_clock_source_check
  CHECK (return_clock_source IS NULL OR return_clock_source = ANY (ARRAY['gps'::text, 'lock'::text, 'manual'::text]));

COMMENT ON COLUMN public.bookings.checkout_clock_source IS
  'Who set rented_out_at: gps yard exit, padlock fallback, or a person.';
COMMENT ON COLUMN public.bookings.return_clock_source IS
  'Who set returned_at: gps yard entry, padlock fallback, or a person.';

CREATE TABLE IF NOT EXISTS public.yards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL DEFAULT 'Yard',
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  radius_meters integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT yards_radius_meters_check CHECK (radius_meters > 0)
);

CREATE TABLE IF NOT EXISTS public.gps_trackers (
  macid text PRIMARY KEY,
  full_name text,
  equipment_id bigint REFERENCES public.equipment(id) ON DELETE SET NULL,
  lock_device_id text REFERENCES public.lock_devices(device_id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gps_trackers_equipment_id
  ON public.gps_trackers USING btree (equipment_id);
CREATE INDEX IF NOT EXISTS idx_gps_trackers_lock_device_id
  ON public.gps_trackers USING btree (lock_device_id);

CREATE TABLE IF NOT EXISTS public.gps_tracker_state (
  macid text PRIMARY KEY REFERENCES public.gps_trackers(macid) ON DELETE CASCADE,
  lat double precision,
  lon double precision,
  gpstime timestamptz,
  hearttime timestamptz,
  speed numeric,
  inside_yard boolean,
  consecutive_outside integer NOT NULL DEFAULT 0,
  consecutive_inside integer NOT NULL DEFAULT 0,
  streak_outside_at timestamptz,
  streak_inside_at timestamptz,
  last_valid_at timestamptz,
  last_reading_at timestamptz,
  valid boolean NOT NULL DEFAULT false,
  positioning_mode integer,
  main_power boolean,
  mileage numeric,
  fuel text,
  operating_status text,
  open_booking_id bigint REFERENCES public.bookings(id) ON DELETE SET NULL,
  checkout_mileage numeric,
  checkout_fuel text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gps_readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  macid text NOT NULL,
  gpstime timestamptz,
  lat double precision,
  lon double precision,
  speed numeric,
  hearttime timestamptz,
  server_time timestamptz,
  device_status text,
  mileage numeric,
  fuel text,
  positioning_mode integer,
  acc boolean,
  main_power boolean,
  operating_status text,
  stale boolean NOT NULL DEFAULT false,
  valid boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gps_readings_received_at
  ON public.gps_readings USING btree (received_at);
CREATE INDEX IF NOT EXISTS idx_gps_readings_macid
  ON public.gps_readings USING btree (macid, received_at DESC);

CREATE TABLE IF NOT EXISTS public.gps_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  macid text,
  booking_id bigint REFERENCES public.bookings(id) ON DELETE SET NULL,
  kind text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS gps_alerts_open_macid_uidx
  ON public.gps_alerts (macid, kind)
  WHERE resolved_at IS NULL AND macid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gps_alerts_open_global_uidx
  ON public.gps_alerts (kind)
  WHERE resolved_at IS NULL AND macid IS NULL;

CREATE INDEX IF NOT EXISTS idx_gps_alerts_open
  ON public.gps_alerts USING btree (created_at DESC)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS public.gps_api_session (
  id boolean PRIMARY KEY DEFAULT true,
  account_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gps_api_session_singleton CHECK (id)
);

COMMENT ON TABLE public.yards IS
  'Circle geofences. No rows means the poller stores fixes and does not emit checkout or return.';
COMMENT ON TABLE public.gps_trackers IS
  'One hardware tracker. equipment_id is set by a person; the poller never guesses it.';
COMMENT ON TABLE public.gps_api_session IS
  'Account id learned from the tracker API. The API key stays in the environment.';

ALTER TABLE public.yards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_trackers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_tracker_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_api_session ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access to yards" ON public.yards;
CREATE POLICY "Admin full access to yards" ON public.yards
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admin full access to gps_trackers" ON public.gps_trackers;
CREATE POLICY "Admin full access to gps_trackers" ON public.gps_trackers
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admin full access to gps_tracker_state" ON public.gps_tracker_state;
CREATE POLICY "Admin full access to gps_tracker_state" ON public.gps_tracker_state
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admin full access to gps_readings" ON public.gps_readings;
CREATE POLICY "Admin full access to gps_readings" ON public.gps_readings
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admin full access to gps_alerts" ON public.gps_alerts;
CREATE POLICY "Admin full access to gps_alerts" ON public.gps_alerts
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admin full access to gps_api_session" ON public.gps_api_session;
CREATE POLICY "Admin full access to gps_api_session" ON public.gps_api_session
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

REVOKE ALL ON TABLE public.yards FROM anon;
REVOKE ALL ON TABLE public.gps_trackers FROM anon;
REVOKE ALL ON TABLE public.gps_tracker_state FROM anon;
REVOKE ALL ON TABLE public.gps_readings FROM anon;
REVOKE ALL ON TABLE public.gps_alerts FROM anon;
REVOKE ALL ON TABLE public.gps_api_session FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.yards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gps_trackers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gps_tracker_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gps_readings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gps_alerts TO authenticated;
GRANT SELECT ON TABLE public.gps_api_session TO authenticated;

GRANT ALL ON TABLE public.yards TO service_role;
GRANT ALL ON TABLE public.gps_trackers TO service_role;
GRANT ALL ON TABLE public.gps_tracker_state TO service_role;
GRANT ALL ON TABLE public.gps_readings TO service_role;
GRANT ALL ON TABLE public.gps_alerts TO service_role;
GRANT ALL ON TABLE public.gps_api_session TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.yards_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gps_readings_id_seq TO authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN ('sync-gps-trackers-2min')
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'sync-gps-trackers-2min',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/sync-gps-trackers',
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
