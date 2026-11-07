-- Time-scoped iglooKey (shareable Bluetooth unlock link) lives on the booking
-- so PIN row replacements (bridge → AlgoPIN failsafe) do not lose the key.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS iglookey_token_id text,
  ADD COLUMN IF NOT EXISTS iglookey_shareable_url text,
  ADD COLUMN IF NOT EXISTS iglookey_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS iglookey_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS iglookey_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS iglookey_revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS bookings_iglookey_token_id_idx
  ON public.bookings (iglookey_token_id)
  WHERE iglookey_token_id IS NOT NULL;
