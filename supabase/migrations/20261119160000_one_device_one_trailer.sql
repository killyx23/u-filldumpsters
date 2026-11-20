-- One GPS macid or Igloo device id belongs to one trailer.
-- A trailer can still have several GPS trackers or several locks; those are
-- different device ids.

DELETE FROM public.unit_accessories newer
USING public.unit_accessories older
WHERE newer.device_id IS NOT NULL
  AND newer.kind = older.kind
  AND newer.device_id = older.device_id
  AND newer.id > older.id;

CREATE UNIQUE INDEX IF NOT EXISTS unit_accessories_kind_device_uidx
  ON public.unit_accessories (kind, device_id)
  WHERE device_id IS NOT NULL;

COMMENT ON INDEX public.unit_accessories_kind_device_uidx IS
  'A vendor device id maps to one accessory, so it cannot be linked to two trailers.';
