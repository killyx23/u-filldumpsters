-- Dump Loader homepage card copy (owner screenshot 2026-06-04). See supabase/seed.sql service id 2.

UPDATE public.services SET
  homepage_description = 'Premium 2025 dump trailer equipped with a wireless remote, power tarp cover, and hydraulic jack for ultimate ease of use. Available for single day or multiple day rental.',
  homepage_price_unit = '/Per day rental',
  features = '["Up to 5 tons capacity", "You pick up and you return or we have delivery available", "Great for junk removal", "Wireless remote control", "Book today, rent as early as tomorrow"]'::jsonb,
  homepage_highlight = 'Incredible Value'
WHERE id = 2;
