-- Add last opened / last closed times to lock_device_presence.
-- Source is lock_device_events (actual padlock activity), not remote job clicks.

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
  ) AS last_closed_at
FROM public.lock_devices d
LEFT JOIN public.lock_bridges b ON b.bridge_id = d.bridge_id
LEFT JOIN public.equipment e ON e.id = d.equipment_id
WHERE d.is_active;

ALTER VIEW public.lock_device_presence SET (security_invoker = on);
REVOKE ALL ON public.lock_device_presence FROM anon;
GRANT SELECT ON public.lock_device_presence TO authenticated, service_role;

COMMENT ON VIEW public.lock_device_presence IS
  'Admin lock status: presence plus last opened (unlock) and last closed (lock) activity times.';
