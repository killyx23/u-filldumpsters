-- DIY badge title, self-serve bullets, remove hardcoded delivery fee from features JSON (live fee from delivery_fee column).

UPDATE public.services SET
  homepage_highlight = 'DIY Heavy Equipment',
  features = '["You pick up & return or we have delivery available", "Easy Self-Serve Rental No-Contact, Hassle-Free", "Great for digging and trenching", "Fits through gates & narrow spaces", "Book today, rent as early as tomorrow", "Saves days of hard physical labor"]'::jsonb
WHERE id = 5;

UPDATE public.services SET
  features = '["Up to 5 tons capacity", "Easy Self-Serve Rental No-Contact, Hassle-Free", "You pick up and you return or we have delivery available", "Great for junk removal", "Wireless remote control", "Book today, rent as early as tomorrow"]'::jsonb
WHERE id = 2;

-- Drop embedded Delivery Fee amount; PlanCard reads services.delivery_fee from admin pricing.
UPDATE public.services SET
  features = '["Up to 2.5 tons of debris", "$100 per extra ton", "Perfect for renovations", "Easy loading"]'::jsonb
WHERE id = 1;
