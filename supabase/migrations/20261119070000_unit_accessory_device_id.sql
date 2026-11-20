-- Vendor id on a unit accessory (GPS macid or Igloo device id).
-- This column is not a secret. Account auth stays in env / vault.
-- If a vendor later requires a per-device credential, store it in Supabase
-- vault and reference that secret from this row. Do not add a secret column here.

ALTER TABLE public.unit_accessories
  ADD COLUMN IF NOT EXISTS device_id text;

COMMENT ON COLUMN public.unit_accessories.device_id IS
  'Vendor device id (GPS macid or Igloo device id). Not a secret. Per-device credentials, if a vendor later requires them, belong in Supabase vault rather than this table.';

-- GPS linking used to stash the macid in notes. Promote that id and clear notes
-- only when the note was nothing but the id.
UPDATE public.unit_accessories accessory
SET device_id = btrim(accessory.notes),
    notes = NULL,
    updated_at = now()
WHERE accessory.kind = 'gps'
  AND accessory.device_id IS NULL
  AND accessory.notes IS NOT NULL
  AND (
    btrim(accessory.notes) ~ '^[0-9]{8,20}$'
    OR EXISTS (
      SELECT 1
      FROM public.gps_trackers tracker
      WHERE tracker.macid = btrim(accessory.notes)
    )
  );

-- Lock linking used the same notes field for the Igloo device id.
UPDATE public.unit_accessories accessory
SET device_id = btrim(accessory.notes),
    notes = NULL,
    updated_at = now()
WHERE accessory.kind = 'lock'
  AND accessory.device_id IS NULL
  AND accessory.notes IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.lock_devices lock_device
    WHERE lock_device.device_id = btrim(accessory.notes)
  );

CREATE UNIQUE INDEX IF NOT EXISTS unit_accessories_unit_kind_device_uidx
  ON public.unit_accessories (inventory_unit_id, kind, device_id)
  WHERE device_id IS NOT NULL;

-- Admin lock panel reads this view. Append the unit link columns so the
-- accessory dropdown can show the current mapping.
CREATE OR REPLACE VIEW public.lock_device_presence
WITH (security_invoker = on) AS
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
  ) AS last_order_id,
  (
    SELECT MAX(ev.occurred_at)
    FROM public.lock_device_events ev
    WHERE ev.device_id = d.device_id
      AND ev.event_kind = 'unlock'
  ) AS last_opened_at,
  (
    SELECT MAX(ev.occurred_at)
    FROM public.lock_device_events ev
    WHERE ev.device_id = d.device_id
      AND ev.event_kind = 'lock'
  ) AS last_closed_at,
  d.inventory_unit_id,
  d.accessory_id
FROM public.lock_devices d
LEFT JOIN public.lock_bridges b ON b.bridge_id = d.bridge_id
LEFT JOIN public.equipment e ON e.id = d.equipment_id
WHERE d.is_active;

ALTER VIEW public.lock_device_presence SET (security_invoker = on);
REVOKE ALL ON public.lock_device_presence FROM anon;
GRANT SELECT ON public.lock_device_presence TO authenticated, service_role;

COMMENT ON VIEW public.lock_device_presence IS
  'Admin lock status: presence, last open/close, and the serial unit / accessory the lock is mounted on.';
