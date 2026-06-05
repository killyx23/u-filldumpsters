-- Remove "100% seamless online booking" from Rock, Mulch, Gravel homepage bullets.

UPDATE public.services SET
  features = '["Premium landscaping materials available", "Prompt, scheduled driveway delivery", "Perfect for residential & commercial projects", "Bulk savings on large orders", "Priced per yard + flat delivery fee", "Book completely online with ease"]'::jsonb
WHERE id = 3;
