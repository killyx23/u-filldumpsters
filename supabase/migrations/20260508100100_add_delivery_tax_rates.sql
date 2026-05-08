-- Migration B: Add delivery-vs-pickup tax rate columns to business_settings,
--             and fix the mismatched default on bookings.tax_rate_used.
--
-- Utah uses destination-based sourcing:
--   - Pickup at business location → tax rate for Saratoga Springs (84045)
--   - Delivery to customer address → tax rate for customer's ZIP (ideally via tax API)
--
-- tax_rate_pickup: stored rate used for self-pickup / self-service-trailer transactions.
-- tax_rate_delivery: fallback rate for delivery when no tax API is configured;
--                    overridden at runtime by the lookup-tax-rate edge function when enabled.

ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS tax_rate_pickup numeric DEFAULT 7.45,
  ADD COLUMN IF NOT EXISTS tax_rate_delivery numeric DEFAULT 7.45;

COMMENT ON COLUMN public.business_settings.tax_rate_pickup IS 'Sales tax rate (%) for self-pickup transactions at business location (Saratoga Springs, UT: 7.45%)';
COMMENT ON COLUMN public.business_settings.tax_rate_delivery IS 'Default sales tax rate (%) for delivery transactions when no tax API lookup is available';

-- Seed pickup/delivery rates from the existing combined rate on row id=1
UPDATE public.business_settings
  SET tax_rate_pickup   = COALESCE(tax_rate, 7.45),
      tax_rate_delivery = COALESCE(tax_rate, 7.45)
  WHERE id = 1;

-- Fix the mismatched default: bookings.tax_rate_used was defaulting to 7.0
-- instead of matching the business_settings value of 7.45.
ALTER TABLE public.bookings
  ALTER COLUMN tax_rate_used SET DEFAULT 7.45;
