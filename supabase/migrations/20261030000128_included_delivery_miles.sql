-- How many delivery miles are included before the per-mile charge starts.
-- Edit the amount any time in Admin → Charges and Fees.
-- Example: 20 included miles on a 25-mile drive charges 5 miles.

INSERT INTO public.charges_and_fees (fee_key, fee_name, fee_description, fee_value, is_percentage)
VALUES (
  'included_delivery_miles',
  'Included Delivery Miles',
  'How many miles are included before the per-mile charge starts. Example: 20 means a 25-mile drive charges 5 miles.',
  30.00,
  false
)
ON CONFLICT (fee_key) DO NOTHING;
