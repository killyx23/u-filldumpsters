-- One bridge-offline email per unlock episode. state_changed_at moves on the
-- next unlock, so a later open can alert again. A repeated offline edge for
-- the same open does not.

ALTER TABLE public.lock_devices
  ADD COLUMN IF NOT EXISTS offline_alerted_for_state_at timestamptz;

COMMENT ON COLUMN public.lock_devices.offline_alerted_for_state_at IS
  'state_changed_at of the unlock episode that already sent the bridge-offline-while-unlocked email.';
