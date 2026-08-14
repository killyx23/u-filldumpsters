-- Rename customer-facing 16 Yard Dumpster Rental listing to Dumpster Rental.
-- Keep size facts in FAQs that answer "what size" (16 ft long, etc.).

UPDATE public.services
SET name = 'Dumpster Rental'
WHERE id = 1
  AND name ILIKE '%16%yard%dumpster%';

UPDATE public.faqs
SET answer = replace(
  answer,
  'The rental price for the 16-yard dumpster includes',
  'Dumpster rental includes'
)
WHERE id = 4
  AND answer ILIKE '%16-yard dumpster%';
