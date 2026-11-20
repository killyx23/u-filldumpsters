-- Serial units under an inventory pool, plus admin accessories (GPS, lock)
-- that hang off a unit. Customer checkout still reserves the pool.

CREATE TABLE IF NOT EXISTS public.inventory_units (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inventory_item_id integer NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  serial text,
  status text NOT NULL DEFAULT 'available',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_units_status_check CHECK (status = ANY (ARRAY['available'::text, 'out'::text, 'out_of_service'::text])),
  CONSTRAINT inventory_units_name_unique UNIQUE (inventory_item_id, name)
);

CREATE INDEX IF NOT EXISTS idx_inventory_units_item
  ON public.inventory_units USING btree (inventory_item_id);

CREATE TABLE IF NOT EXISTS public.unit_accessories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inventory_unit_id bigint NOT NULL REFERENCES public.inventory_units(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unit_accessories_kind_check CHECK (kind = ANY (ARRAY['gps'::text, 'lock'::text, 'other'::text])),
  CONSTRAINT unit_accessories_quantity_check CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_unit_accessories_unit
  ON public.unit_accessories USING btree (inventory_unit_id);

CREATE TABLE IF NOT EXISTS public.booking_unit_assignments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id bigint NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  inventory_unit_id bigint NOT NULL REFERENCES public.inventory_units(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_unit_assignments_open_booking_uidx
  ON public.booking_unit_assignments (booking_id)
  WHERE released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS booking_unit_assignments_open_unit_uidx
  ON public.booking_unit_assignments (inventory_unit_id)
  WHERE released_at IS NULL;

COMMENT ON TABLE public.inventory_units IS
  'One physical unit inside an inventory pool, such as a named trailer.';
COMMENT ON TABLE public.unit_accessories IS
  'Admin hardware on a unit. Not a customer checkout line.';
COMMENT ON TABLE public.booking_unit_assignments IS
  'Which physical unit went out on a booking. Open rows have released_at null.';

ALTER TABLE public.gps_trackers
  ADD COLUMN IF NOT EXISTS inventory_unit_id bigint REFERENCES public.inventory_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accessory_id bigint REFERENCES public.unit_accessories(id) ON DELETE SET NULL;

ALTER TABLE public.lock_devices
  ADD COLUMN IF NOT EXISTS inventory_unit_id bigint REFERENCES public.inventory_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accessory_id bigint REFERENCES public.unit_accessories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gps_trackers_inventory_unit
  ON public.gps_trackers USING btree (inventory_unit_id);
CREATE INDEX IF NOT EXISTS idx_lock_devices_inventory_unit
  ON public.lock_devices USING btree (inventory_unit_id);

-- One trailer under the roll-off pool, with the known tracker attached.
INSERT INTO public.inventory_units (inventory_item_id, name, status, is_active)
SELECT item.id, 'Sure Trac Trailer', 'available', true
FROM public.inventory_items item
WHERE item.name ILIKE '%roll-off%' OR item.name ILIKE '%rolloff%' OR item.name ILIKE '%trailer%'
ORDER BY CASE WHEN item.name ILIKE '%roll-off%' OR item.name ILIKE '%rolloff%' THEN 0 ELSE 1 END, item.id
LIMIT 1
ON CONFLICT (inventory_item_id, name) DO NOTHING;

INSERT INTO public.unit_accessories (inventory_unit_id, kind, name, quantity, notes)
SELECT unit.id, 'gps', 'Sure Trac Trailer GPS', 1, '19176266213'
FROM public.inventory_units unit
WHERE unit.name = 'Sure Trac Trailer'
  AND NOT EXISTS (
    SELECT 1 FROM public.unit_accessories existing
    WHERE existing.inventory_unit_id = unit.id AND existing.kind = 'gps' AND existing.notes = '19176266213'
  );

UPDATE public.gps_trackers tracker
SET inventory_unit_id = unit.id,
    accessory_id = accessory.id,
    updated_at = now()
FROM public.inventory_units unit
JOIN public.unit_accessories accessory
  ON accessory.inventory_unit_id = unit.id
 AND accessory.kind = 'gps'
 AND accessory.notes = '19176266213'
WHERE tracker.macid = '19176266213'
  AND unit.name = 'Sure Trac Trailer'
  AND tracker.inventory_unit_id IS NULL;

ALTER TABLE public.inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_accessories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_unit_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access to inventory_units" ON public.inventory_units;
CREATE POLICY "Admin full access to inventory_units" ON public.inventory_units
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admin full access to unit_accessories" ON public.unit_accessories;
CREATE POLICY "Admin full access to unit_accessories" ON public.unit_accessories
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

DROP POLICY IF EXISTS "Admin full access to booking_unit_assignments" ON public.booking_unit_assignments;
CREATE POLICY "Admin full access to booking_unit_assignments" ON public.booking_unit_assignments
  USING ((auth.role() = 'service_role') OR public.is_admin())
  WITH CHECK ((auth.role() = 'service_role') OR public.is_admin());

REVOKE ALL ON TABLE public.inventory_units FROM anon;
REVOKE ALL ON TABLE public.unit_accessories FROM anon;
REVOKE ALL ON TABLE public.booking_unit_assignments FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inventory_units TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.unit_accessories TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_unit_assignments TO authenticated, service_role;

GRANT USAGE, SELECT ON SEQUENCE public.inventory_units_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.unit_accessories_id_seq TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.booking_unit_assignments_id_seq TO authenticated, service_role;
