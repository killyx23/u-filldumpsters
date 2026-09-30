UPDATE public.lock_bridges b
SET is_online = true,
    last_changed_at = coalesce(b.last_changed_at, now())
WHERE b.is_online IS NULL
  AND EXISTS (
    SELECT 1
      FROM public.lock_devices d
     WHERE d.bridge_id = b.bridge_id
       AND d.last_event_at IS NOT NULL
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lock_devices TO authenticated;
