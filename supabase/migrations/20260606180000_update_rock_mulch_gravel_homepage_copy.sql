-- Rock, Mulch, Gravel homepage card copy (service id 3).

UPDATE public.services SET
  homepage_description = 'Transform your landscape without the heavy lifting. Seamlessly choose your materials and secure your spot online. We deliver premium-grade rock, mulch, sand, and gravel directly to your home or job site, saving you multiple trips to the supply yard and hours of backbreaking labor.',
  features = '["Premium landscaping materials available", "100% seamless online booking", "Prompt, scheduled driveway delivery", "Perfect for residential & commercial projects", "Bulk savings on large orders", "Priced per yard + flat delivery fee", "Book completely online with ease"]'::jsonb
WHERE id = 3;
