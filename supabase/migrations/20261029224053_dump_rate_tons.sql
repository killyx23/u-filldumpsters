-- How many tons the landfill disposal rate covers.
-- Edit the amount any time in Admin → Charges and Fees.
-- Example: a rate of $45 and a tonnage of 0.5 reads as "$45.00 for 0.5 tons".

INSERT INTO public.charges_and_fees (fee_key, fee_name, fee_description, fee_value, is_percentage)
VALUES (
  'dump_rate_tons',
  'Landfill Rate Tonnage',
  'How many tons the landfill disposal rate covers. Example: $45 for 0.5 tons.',
  1.00,
  false
)
ON CONFLICT (fee_key) DO NOTHING;

UPDATE public.charges_and_fees
SET
  fee_name = 'Municipal Landfill Scale Rate',
  fee_description = 'Dollar amount charged for the tonnage set in Landfill Rate Tonnage.'
WHERE fee_key = 'dump_tonnage_rate';
