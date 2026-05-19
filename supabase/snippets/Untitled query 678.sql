-- bookings
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'bookings'
  AND column_name IN ('delivery_type', 'tax_jurisdiction', 'tax_zip_used');
-- pending_customers
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pending_customers'
  AND column_name = 'subtotal_before_tax';
-- services
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'services'
  AND column_name IN ('is_taxable', 'delivery_fee_is_taxable', 'mileage_is_taxable');
-- tax_rate_cache table
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'tax_rate_cache'
) AS tax_rate_cache_exists;
