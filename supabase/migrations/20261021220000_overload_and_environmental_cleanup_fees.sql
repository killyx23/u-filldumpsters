-- Flat dollar fees quoted in the rental agreement.
-- Edit the amounts any time in Admin → Charges and Fees.
INSERT INTO public.charges_and_fees (fee_key, fee_name, fee_description, fee_value, is_percentage)
VALUES
(
  'overload_fee',
  'Overload Fee',
  'Flat dollar amount charged when a dumpster or trailer is loaded past the weight limit or the heavy-material height limit.',
  150.00,
  false
),
(
  'environmental_cleanup_fee',
  'Environmental Clean-up Fee',
  'Flat dollar amount charged when prohibited or hazardous materials are found in the equipment, before the actual disposal cost.',
  250.00,
  false
)
ON CONFLICT (fee_key) DO NOTHING;
