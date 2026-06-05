-- Canonical homepage marketing copy (see supabase/seed.sql services id 1–5).
-- Restores trailer-first order; DIY Heavy Equipment card per owner screenshot (2026-06-04).

-- Display order: Dump Loader, 16 Yard, DIY Heavy Equipment, Rock/Mulch/Gravel
UPDATE public.services SET display_order = 2 WHERE id = 1;
UPDATE public.services SET display_order = 1 WHERE id = 2;
UPDATE public.services SET display_order = 3 WHERE id = 5;
UPDATE public.services SET display_order = 4 WHERE id = 3;

-- 16 Yard Dumpster (id 1)
UPDATE public.services SET
  homepage_description = '$300 for delivery, pickup, & first day. Plus $50/additional day. Special: Rent for 7 days for only $500!',
  display_order = 2,
  homepage_highlight = 'Our Most Popular Service'
WHERE id = 1;

-- Dump Loader (id 2): see 20260606140000_restore_dump_loader_homepage_copy.sql for card text
UPDATE public.services SET
  display_order = 1,
  homepage_highlight = 'Incredible Value'
WHERE id = 2;

-- Rock, Mulch, Gravel (id 3)
UPDATE public.services SET
  homepage_description = 'Delivery service for landscaping materials. Get rock, mulch, or gravel delivered right to your site.',
  display_order = 4,
  homepage_highlight = 'Save Money and Time'
WHERE id = 3;

-- DIY Heavy Equipment / Mini Excavator (id 5)
UPDATE public.services SET
  name = 'DIY Heavy Equipment',
  description = 'Tackle tough backyard projects without the strain. Our compact machinery fits through standard yard gates to deliver heavy-duty digging and lifting power in tight spaces.',
  homepage_description = 'Tackle tough backyard projects without the strain. Our compact machinery fits through standard yard gates to deliver heavy-duty digging and lifting power in tight spaces.',
  homepage_price = 150,
  homepage_price_unit = '/Per day rental',
  features = '["You pick up & return or we have delivery available", "Great for digging and trenching", "Fits through gates & narrow spaces", "Book today, rent as early as tomorrow", "Saves days of hard physical labor"]'::jsonb,
  display_order = 3,
  homepage_highlight = NULL
WHERE id = 5;
