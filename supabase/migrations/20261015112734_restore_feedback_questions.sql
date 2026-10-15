-- Restore the original How can we do better questions after they were deleted in admin.
-- anything_else stays inactive because it repeats the survey notes box.
INSERT INTO public.feedback_questions (prompt, field_key, input_type, options, sort_order, is_active, is_required)
VALUES
  (
    'Why did you leave today?',
    'why_left',
    'single_choice',
    '["Just browsing","Price felt high","Could not find the right dates","Website was confusing","Changed my mind","Other"]'::jsonb,
    10,
    true,
    true
  ),
  (
    'What almost stopped you from finishing?',
    'almost_stopped',
    'single_choice',
    '["Pricing","Scheduling / availability","Payment concerns","Missing information","Technical issue","Nothing specific","Other"]'::jsonb,
    20,
    true,
    true
  ),
  (
    'How did our pricing feel?',
    'pricing',
    'single_choice',
    '["Great value","Fair","A bit high","Too expensive","Not sure"]'::jsonb,
    30,
    true,
    false
  ),
  (
    'How was scheduling / availability?',
    'scheduling',
    'single_choice',
    '["Easy to find dates","Limited options","Dates did not work","Confusing","Not sure"]'::jsonb,
    40,
    true,
    false
  ),
  (
    'How easy was the website to use?',
    'website_ease',
    'single_choice',
    '["Very easy","Mostly easy","Okay","Difficult","Very difficult"]'::jsonb,
    50,
    true,
    false
  ),
  (
    'Did our services fit the job you needed done?',
    'service_fit',
    'single_choice',
    '["Perfect fit","Mostly fit","Somewhat","Not really","Not sure"]'::jsonb,
    60,
    true,
    false
  ),
  (
    'Anything else we should know?',
    'anything_else',
    'short_text',
    '[]'::jsonb,
    70,
    false,
    false
  )
ON CONFLICT (field_key) DO UPDATE SET
  prompt = EXCLUDED.prompt,
  input_type = EXCLUDED.input_type,
  options = EXCLUDED.options,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  is_required = EXCLUDED.is_required,
  updated_at = timezone('utc', now());
