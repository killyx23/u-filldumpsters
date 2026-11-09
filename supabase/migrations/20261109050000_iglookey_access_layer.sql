-- Layer 1 (iglooKey): Bluetooth digital key shareable URL rows in rental_access_codes.

ALTER TABLE public.rental_access_codes
  DROP CONSTRAINT IF EXISTS rental_access_codes_pin_type_check;

ALTER TABLE public.rental_access_codes
  ADD CONSTRAINT rental_access_codes_pin_type_check
  CHECK (pin_type = ANY (ARRAY['algopin'::text, 'bridge_proxied'::text, 'iglookey'::text]));

ALTER TABLE public.rental_access_codes
  ADD COLUMN IF NOT EXISTS shareable_url text;

COMMENT ON COLUMN public.rental_access_codes.shareable_url IS
  'IglooKey pass.igloohome.co (or app.link) URL when pin_type = iglookey. pin_id stores the Igloo token id.';

-- iglooKey rows do not use a keypad PIN; keep access_pin as empty string.
ALTER TABLE public.rental_access_codes
  ALTER COLUMN access_pin SET DEFAULT '';

CREATE INDEX IF NOT EXISTS rental_access_codes_iglookey_active_idx
  ON public.rental_access_codes (order_id, status)
  WHERE pin_type = 'iglookey';
