-- End the padlock was actually given. end_time can move on an extension so
-- later unlocks still match the booking. programmed_end_time stays put.
ALTER TABLE public.rental_access_codes
  ADD COLUMN IF NOT EXISTS programmed_end_time timestamptz;
