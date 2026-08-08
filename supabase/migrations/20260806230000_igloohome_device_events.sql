-- Igloohome webhook device tracking:
--   * lock_devices / lock_bridges — current state of physical hardware
--   * lock_device_events — raw device-scoped event ledger (lock/unlock/breakin)
--   * lock_jobs — Job Complete (event type 3) results
--   * lock_device_presence — "is this equipment on premises" reporting view
--
-- rental_tracking_logs stays the booking-scoped ledger the rental state machine
-- and overdue-fee UI already read. These tables answer the hardware-level
-- question independently of whether a booking is matched.

CREATE TABLE IF NOT EXISTS public.lock_bridges (
  bridge_id text PRIMARY KEY,
  label text,
  is_online boolean,
  last_changed_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lock_devices (
  device_id text PRIMARY KEY,
  bridge_id text REFERENCES public.lock_bridges(bridge_id) ON DELETE SET NULL,
  equipment_id bigint REFERENCES public.equipment(id) ON DELETE SET NULL,
  label text,
  current_state text NOT NULL DEFAULT 'unknown',
  state_changed_at timestamptz,
  last_event_at timestamptz,
  last_breakin_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lock_devices_current_state_check
    CHECK (current_state = ANY (ARRAY['locked'::text, 'unlocked'::text, 'unknown'::text]))
);

CREATE TABLE IF NOT EXISTS public.lock_device_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  bridge_id text,
  event_kind text NOT NULL,
  log_type integer,
  occurred_at timestamptz NOT NULL,
  order_id bigint REFERENCES public.bookings(id) ON DELETE SET NULL,
  pin_matched boolean NOT NULL DEFAULT false,
  key_id text,
  operation_id text,
  raw jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lock_device_events_event_kind_check
    CHECK (event_kind = ANY (ARRAY['lock'::text, 'unlock'::text, 'breakin'::text, 'other'::text]))
);

CREATE TABLE IF NOT EXISTS public.lock_jobs (
  job_id text PRIMARY KEY,
  device_id text,
  job_type integer,
  job_status integer,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dedup identical deliveries (igloohome retries, and the 5-minute poller can
-- surface the same on-device log the webhook already delivered).
-- The nullable columns are coalesced because Postgres treats NULLs as distinct
-- in a unique index, which would let duplicates through.
CREATE UNIQUE INDEX IF NOT EXISTS lock_device_events_dedup_uidx
  ON public.lock_device_events (
    device_id,
    (COALESCE(log_type, -1)),
    occurred_at,
    (COALESCE(operation_id, ''))
  );

CREATE INDEX IF NOT EXISTS idx_lock_device_events_occurred_at
  ON public.lock_device_events USING btree (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lock_device_events_device
  ON public.lock_device_events USING btree (device_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lock_device_events_order_id
  ON public.lock_device_events USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_lock_devices_equipment_id
  ON public.lock_devices USING btree (equipment_id);

COMMENT ON TABLE public.lock_device_events IS
  'Raw igloohome activity log entries. PIN values are stripped before storage.';
COMMENT ON COLUMN public.lock_device_events.occurred_at IS
  'From the activity log entryDate (epoch seconds), not webhook delivery time.';
COMMENT ON COLUMN public.lock_devices.current_state IS
  'Last known physical lock state, driven by webhook activity events.';

-- Break-in attempts (logType 53) belong on the booking timeline too.
ALTER TABLE public.rental_tracking_logs
  DROP CONSTRAINT IF EXISTS rental_tracking_logs_event_type_check;
ALTER TABLE public.rental_tracking_logs
  ADD CONSTRAINT rental_tracking_logs_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'unlock'::text, 'lock'::text, 'breakin'::text,
    'pin_generated'::text, 'admin_override'::text, 'sync_error'::text
  ]));

-- Presence view: what an admin needs to answer "where is my equipment".
CREATE OR REPLACE VIEW public.lock_device_presence AS
SELECT
  d.device_id,
  d.label,
  d.equipment_id,
  e.name AS equipment_name,
  d.bridge_id,
  d.current_state,
  d.state_changed_at,
  d.last_event_at,
  d.last_breakin_at,
  b.is_online AS bridge_online,
  b.last_changed_at AS bridge_changed_at,
  CASE
    WHEN d.current_state = 'unlocked' AND b.is_online IS FALSE THEN 'alert_open_and_offline'
    WHEN d.current_state = 'unlocked' THEN 'off_premises'
    WHEN d.current_state = 'locked' THEN 'on_premises'
    ELSE 'unknown'
  END AS presence,
  (
    SELECT ev.order_id
    FROM public.lock_device_events ev
    WHERE ev.device_id = d.device_id
      AND ev.order_id IS NOT NULL
    ORDER BY ev.occurred_at DESC
    LIMIT 1
  ) AS last_order_id
FROM public.lock_devices d
LEFT JOIN public.lock_bridges b ON b.bridge_id = d.bridge_id
LEFT JOIN public.equipment e ON e.id = d.equipment_id
WHERE d.is_active;

ALTER TABLE public.lock_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lock_bridges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lock_device_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lock_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access to lock_devices" ON public.lock_devices;
CREATE POLICY "Admin full access to lock_devices" ON public.lock_devices
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admin full access to lock_bridges" ON public.lock_bridges;
CREATE POLICY "Admin full access to lock_bridges" ON public.lock_bridges
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admin full access to lock_device_events" ON public.lock_device_events;
CREATE POLICY "Admin full access to lock_device_events" ON public.lock_device_events
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admin full access to lock_jobs" ON public.lock_jobs;
CREATE POLICY "Admin full access to lock_jobs" ON public.lock_jobs
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

REVOKE ALL ON TABLE public.lock_devices FROM anon;
REVOKE ALL ON TABLE public.lock_bridges FROM anon;
REVOKE ALL ON TABLE public.lock_device_events FROM anon;
REVOKE ALL ON TABLE public.lock_jobs FROM anon;

GRANT SELECT ON TABLE public.lock_devices TO authenticated;
GRANT SELECT ON TABLE public.lock_bridges TO authenticated;
GRANT SELECT ON TABLE public.lock_device_events TO authenticated;
GRANT SELECT ON TABLE public.lock_jobs TO authenticated;
GRANT ALL ON TABLE public.lock_devices TO service_role;
GRANT ALL ON TABLE public.lock_bridges TO service_role;
GRANT ALL ON TABLE public.lock_device_events TO service_role;
GRANT ALL ON TABLE public.lock_jobs TO service_role;

-- The view runs with the querying user's privileges so the RLS above applies.
ALTER VIEW public.lock_device_presence SET (security_invoker = on);
REVOKE ALL ON public.lock_device_presence FROM anon;
GRANT SELECT ON public.lock_device_presence TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.touch_lock_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_devices_touch_updated_at ON public.lock_devices;
CREATE TRIGGER lock_devices_touch_updated_at
  BEFORE UPDATE ON public.lock_devices
  FOR EACH ROW EXECUTE FUNCTION public.touch_lock_updated_at();

DROP TRIGGER IF EXISTS lock_bridges_touch_updated_at ON public.lock_bridges;
CREATE TRIGGER lock_bridges_touch_updated_at
  BEFORE UPDATE ON public.lock_bridges
  FOR EACH ROW EXECUTE FUNCTION public.touch_lock_updated_at();

DROP TRIGGER IF EXISTS lock_jobs_touch_updated_at ON public.lock_jobs;
CREATE TRIGGER lock_jobs_touch_updated_at
  BEFORE UPDATE ON public.lock_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_lock_updated_at();
