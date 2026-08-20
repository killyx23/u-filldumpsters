-- Rename leftover DIY Heavy Equipment labels to Compact Equipment.
-- Mini Excavator (id 5) and Mini Telescoping Loader (id 8) stay as machine names.
-- Homepage category label is Compact Equipment in the frontend.

UPDATE public.services
SET
  name = replace(name, 'DIY Heavy Equipment', 'Compact Equipment'),
  description = replace(description, 'DIY Heavy Equipment', 'Compact Equipment'),
  homepage_description = replace(homepage_description, 'DIY Heavy Equipment', 'Compact Equipment'),
  homepage_highlight = CASE
    WHEN homepage_highlight ILIKE '%DIY Heavy Equipment%' THEN 'Save Your Back & Time'
    ELSE homepage_highlight
  END
WHERE name ILIKE '%DIY Heavy Equipment%'
   OR description ILIKE '%DIY Heavy Equipment%'
   OR homepage_description ILIKE '%DIY Heavy Equipment%'
   OR homepage_highlight ILIKE '%DIY Heavy Equipment%';

UPDATE public.faqs
SET
  question = replace(question, 'DIY Heavy Equipment', 'Compact Equipment'),
  answer = replace(
    replace(answer, 'DIY Heavy Equipment', 'Compact Equipment'),
    'diy heavy equipment',
    'compact equipment'
  )
WHERE question ILIKE '%DIY Heavy%'
   OR answer ILIKE '%DIY Heavy%';

UPDATE public.ai_knowledge_base
SET
  title = replace(title, 'DIY Heavy Equipment', 'Compact Equipment'),
  content = replace(content, 'DIY Heavy Equipment', 'Compact Equipment')
WHERE title ILIKE '%DIY Heavy%'
   OR content ILIKE '%DIY Heavy%';

UPDATE public.bookings
SET plan = jsonb_set(plan, '{name}', to_jsonb('Compact Equipment'::text))
WHERE plan->>'name' ILIKE '%DIY Heavy Equipment%';

UPDATE public.pending_customers
SET plan_data = jsonb_set(plan_data, '{name}', to_jsonb('Compact Equipment'::text))
WHERE plan_data->>'name' ILIKE '%DIY Heavy Equipment%';
