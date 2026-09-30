-- Activity through a bridge proves it is reachable. Rows created only via
-- ensureBridge (lock/unlock) left is_online NULL, so Settings showed
-- "Bridge: unreported" even with recent open/close times. Event type 10 still
-- owns true offline transitions going forward.

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

-- Admins need write privileges to link lock_devices.equipment_id from Settings.
-- RLS already restricts writes to is_admin() / service_role.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lock_devices TO authenticated;
