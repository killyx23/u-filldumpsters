-- Advance reschedule fee (% of original total when request is more than 24h before appointment)
-- Pair with late_reschedule_percentage (within 24 hours). Default 0 preserves prior "waived" advance behavior.
INSERT INTO public.charges_and_fees (
  fee_key,
  fee_name,
  fee_description,
  fee_value,
  is_percentage
)
VALUES (
  'advance_reschedule_percentage',
  'Advance Reschedule Fee (%)',
  'Percentage of the original booking total charged when a reschedule is requested more than 24 hours before the original appointment. Typically lower than a late reschedule fee.',
  0,
  true
)
ON CONFLICT (fee_key) DO UPDATE SET
  fee_name = EXCLUDED.fee_name,
  fee_description = EXCLUDED.fee_description,
  is_percentage = EXCLUDED.is_percentage;

-- Tighten late reschedule description so it pairs clearly with advance_reschedule_percentage
UPDATE public.charges_and_fees
SET
  fee_description = 'Percentage of the original booking total charged when a reschedule is requested within 24 hours of the original appointment. Higher than the advance reschedule fee because last-minute date changes often cannot be filled by another customer.',
  updated_at = now()
WHERE fee_key = 'late_reschedule_percentage';
