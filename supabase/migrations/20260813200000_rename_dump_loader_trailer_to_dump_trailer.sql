-- Rename customer-facing Dump Loader Trailer copy to Dump Trailer.
-- Keep fee_key dump_loader_max_tons (code identifier).

UPDATE public.services
SET
  name = replace(replace(name, 'Dump Loader Trailer', 'Dump Trailer'), 'Dump Loader', 'Dump Trailer'),
  description = replace(replace(replace(description, 'Dump Loader Trailer', 'Dump Trailer'), 'dump loader trailer', 'dump trailer'), 'dump loader', 'dump trailer'),
  homepage_description = replace(replace(replace(homepage_description, 'Dump Loader Trailer', 'Dump Trailer'), 'dump loader trailer', 'dump trailer'), 'dump loader', 'dump trailer')
WHERE id IN (2, 4);

UPDATE public.faqs
SET
  question = replace(replace(question, 'Dump Loader Trailer', 'Dump Trailer'), 'Dump Loader', 'Dump Trailer'),
  answer = replace(
    replace(
      replace(replace(answer, 'Dump Loader Trailer', 'Dump Trailer'), 'Dump Loader', 'Dump Trailer'),
      'dump loader trailer',
      'dump trailer'
    ),
    'dump loader',
    'dump trailer'
  )
WHERE question ILIKE '%dump loader%'
   OR answer ILIKE '%dump loader%';

UPDATE public.charges_and_fees
SET
  fee_name = 'Dump Trailer Maximum Tonnage Limit',
  fee_description = 'The total safe transport threshold cap for the dump trailer systems.'
WHERE fee_key = 'dump_loader_max_tons';
