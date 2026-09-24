-- Keep homepage_price in sync with admin Service Pricing (base_price).
-- Stale marketing homepage_price values were overriding live catalog cards.

UPDATE public.services
SET
  homepage_price = base_price,
  homepage_price_unit = price_unit
WHERE homepage_price IS DISTINCT FROM base_price
   OR homepage_price_unit IS DISTINCT FROM price_unit;
