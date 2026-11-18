-- Vendor alarm history from yzxgps alarmOperation (fence enter/leave, removal, etc).

CREATE TABLE IF NOT EXISTS public.gps_vendor_alarms (
  id text PRIMARY KEY,
  macid text NOT NULL,
  objectid text,
  classify integer NOT NULL,
  ptime timestamptz,
  lat double precision,
  lon double precision,
  speed numeric,
  notea text,
  status integer,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gps_vendor_alarms_macid_ptime
  ON public.gps_vendor_alarms USING btree (macid, ptime DESC);

CREATE INDEX IF NOT EXISTS idx_gps_vendor_alarms_classify
  ON public.gps_vendor_alarms USING btree (classify, ptime DESC);

COMMENT ON TABLE public.gps_vendor_alarms IS
  'Rows from method=alarmOperation. classify 3 is leave fence, 4 is enter fence.';

ALTER TABLE public.gps_vendor_alarms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access to gps_vendor_alarms" ON public.gps_vendor_alarms;
CREATE POLICY "Admin full access to gps_vendor_alarms" ON public.gps_vendor_alarms
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

REVOKE ALL ON TABLE public.gps_vendor_alarms FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gps_vendor_alarms TO authenticated;
GRANT ALL ON TABLE public.gps_vendor_alarms TO service_role;
