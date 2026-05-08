-- Migration D: Extend tax_records for richer audit information.
--
-- New columns:
--   delivery_type         – mirrors bookings.delivery_type for standalone audit queries
--   taxable_subtotal      – sum of only the taxable line items (pre-discount)
--   non_taxable_subtotal  – sum of non-taxable line items (e.g., insurance)
--   line_items            – JSONB snapshot of every charge with its is_taxable flag and amount
--   tax_jurisdiction      – human-readable jurisdiction string (e.g., "Saratoga Springs, UT")
--   tax_api_used          – whether a real-time tax API (TaxJar etc.) was used for this rate

ALTER TABLE public.tax_records
  ADD COLUMN IF NOT EXISTS delivery_type text
    CHECK (delivery_type IN ('delivery', 'self_service_trailer', 'self_pickup')),
  ADD COLUMN IF NOT EXISTS taxable_subtotal numeric,
  ADD COLUMN IF NOT EXISTS non_taxable_subtotal numeric,
  ADD COLUMN IF NOT EXISTS line_items jsonb,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction text,
  ADD COLUMN IF NOT EXISTS tax_api_used boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tax_records.delivery_type IS 'Delivery mode at the time of booking; mirrors bookings.delivery_type';
COMMENT ON COLUMN public.tax_records.taxable_subtotal IS 'Subtotal of taxable line items only, before discount';
COMMENT ON COLUMN public.tax_records.non_taxable_subtotal IS 'Subtotal of non-taxable line items (e.g., insurance/damage waivers)';
COMMENT ON COLUMN public.tax_records.line_items IS 'Snapshot of all charge line items: [{label, amount, is_taxable}]';
COMMENT ON COLUMN public.tax_records.tax_jurisdiction IS 'Tax jurisdiction string, e.g. "Saratoga Springs, UT 84045"';
COMMENT ON COLUMN public.tax_records.tax_api_used IS 'True when a real-time tax API (TaxJar, Avalara) supplied the rate; false when the business_settings fallback was used';
