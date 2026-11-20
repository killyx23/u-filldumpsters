-- The 5-minute GPS cron writes these tables. Admin settings listens
-- on supabase_realtime instead of waiting for Sync now.

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'gps_trackers',
    'gps_tracker_state',
    'gps_alerts',
    'gps_vendor_alarms'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target);
    END IF;
  END LOOP;
END $$;
