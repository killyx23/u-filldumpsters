-- Restore homepage card order (trailer first) and full marketing copy for self-pickup services.
-- Fixes short homepage_description overriding the long operational description on plan cards.

-- Display order: left to right = Dump Loader, 16 Yard, Mini Excavator, Rock/Mulch/Gravel
UPDATE public.services SET display_order = 2 WHERE id = 1;
UPDATE public.services SET display_order = 1 WHERE id = 2;
UPDATE public.services SET display_order = 3 WHERE id = 5;
UPDATE public.services SET display_order = 4 WHERE id = 3;

-- Dump Loader (id 2): show full operational paragraph on homepage cards
UPDATE public.services SET
  description = 'Top-end dump loader with wireless remote, power tarp cover, and hydraulic jack for ease of use. We offer same-day or multiple-day rentals. Pick up starts for our same-day rental at 8 AM, but it must be returned by 10 PM that day. (Pick up location is in South Saratoga Springs.) The Towing vehicle is required to fit: A Ball Hitch Size of (2-5/16").',
  homepage_description = 'Top-end dump loader with wireless remote, power tarp cover, and hydraulic jack for ease of use. We offer same-day or multiple-day rentals. Pick up starts for our same-day rental at 8 AM, but it must be returned by 10 PM that day. (Pick up location is in South Saratoga Springs.) The Towing vehicle is required to fit: A Ball Hitch Size of (2-5/16").',
  features = '["Up to 5 tons capacity", "You pick up & return", "Great for junk removal", "Wireless remote control"]'::jsonb
WHERE id = 2;

-- Mini Excavator (id 5): expanded paragraph and key points for self-pickup rentals
UPDATE public.services SET
  description = 'Mini excavator rental for digging, trenching, grading, and small excavation projects. Same-day or multi-day rentals available. Pick up starts for our same-day rental at 8 AM, but it must be returned by 10 PM that day. (Pick up location is in South Saratoga Springs.)',
  homepage_description = 'Mini excavator rental for digging, trenching, grading, and small excavation projects. Same-day or multi-day rentals available. Pick up starts for our same-day rental at 8 AM, but it must be returned by 10 PM that day. (Pick up location is in South Saratoga Springs.)',
  features = '["You pick up & return", "Great for digging and trenching", "Compact job-site access", "Same-day or multi-day rental", "Pick up 8 AM - return by 10 PM", "South Saratoga Springs yard"]'::jsonb
WHERE id = 5;
