-- Enable realtime so customer portal lock status updates live.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rental_tracking_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rental_tracking_logs;
  END IF;
END $$;
