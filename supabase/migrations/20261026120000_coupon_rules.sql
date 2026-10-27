-- Coupon rules: dynamic, day-based deals with optional marketing copy.
--
-- Adds a `rules` JSONB array alongside the legacy flat discount_type/discount_value
-- columns (which remain the fallback for simple coupons). Each rule object has the
-- shape:
--
--   {
--     "condition": { "minDays": 2, "maxDays": null },
--     "benefit":   { "type": "percentage_off", "value": 25, "appliesTo": "base_rental" },
--     "advertise": true,
--     "headline":  "Rent 5 days, get a free equipment rental",
--     "description": "Automatically applied at checkout."
--   }
--
-- benefit.type is one of: 'percentage_off' | 'fixed_off' | 'free_days' | 'issue_coupon'.
-- The advertise/headline/description fields drive customer-facing marketing of the deal
-- (booking page nudges, confirmation emails, site promos).

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS coupon_kind text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.coupons.coupon_kind IS
  'Discriminator: ''flat'' uses discount_type/discount_value; ''rules'' evaluates the rules array.';
COMMENT ON COLUMN public.coupons.rules IS
  'Array of day-based deal rules. Each rule has condition, benefit, and optional advertise/headline/description marketing fields.';
