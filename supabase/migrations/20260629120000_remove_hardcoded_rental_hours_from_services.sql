-- Remove hardcoded pickup/return hours from self-pickup service copy.
-- Schedule times are injected at runtime from date_specific_availability / service_availability.

UPDATE public.services SET
  description = 'Top-end dump loader with wireless remote, power tarp cover, and hydraulic jack for ease of use. We offer same-day or multiple-day rentals. (Pick up location is in South Saratoga Springs.) The Towing vehicle is required to fit: A Ball Hitch Size of (2-5/16").',
  homepage_description = 'Top-end dump loader with wireless remote, power tarp cover, and hydraulic jack for ease of use. We offer same-day or multiple-day rentals. (Pick up location is in South Saratoga Springs.) The Towing vehicle is required to fit: A Ball Hitch Size of (2-5/16").'
WHERE id = 2;

UPDATE public.services SET
  description = 'Mini excavator rental for digging, trenching, grading, and small excavation projects. Same-day or multi-day rentals available. (Pick up location is in South Saratoga Springs.)',
  homepage_description = 'Mini excavator rental for digging, trenching, grading, and small excavation projects. Same-day or multi-day rentals available. (Pick up location is in South Saratoga Springs.)',
  features = '["You pick up & return", "Great for digging and trenching", "Compact job-site access", "Same-day or multi-day rental", "Flexible pickup and return hours", "South Saratoga Springs yard"]'::jsonb
WHERE id = 5;
