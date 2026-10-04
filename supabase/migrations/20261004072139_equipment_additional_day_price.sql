ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS additional_day_price numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.equipment.additional_day_price IS
  'Charge for each rental day after the first. The equipment.price covers day one.';

ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_additional_day_price_nonnegative;

ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_additional_day_price_nonnegative
  CHECK (additional_day_price >= 0);
