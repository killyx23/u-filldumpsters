-- Late reschedule fee (% of original total when request is within 24h of original appointment)
INSERT INTO public.charges_and_fees (
  fee_key,
  fee_name,
  fee_description,
  fee_value,
  is_percentage
)
VALUES (
  'late_reschedule_percentage',
  'Late Reschedule Fee (%)',
  'Percentage of the original booking total charged when a reschedule is requested within 24 hours of the original appointment. Scheduling may waive this fee when more than 24 hours remain.',
  5,
  true
)
ON CONFLICT (fee_key) DO UPDATE SET
  fee_name = EXCLUDED.fee_name,
  fee_description = EXCLUDED.fee_description,
  is_percentage = EXCLUDED.is_percentage;
