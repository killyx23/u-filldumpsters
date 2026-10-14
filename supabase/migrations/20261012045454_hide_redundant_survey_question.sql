-- "Anything else we should know?" repeats the required notes box on the survey.
UPDATE public.feedback_questions
SET is_active = false
WHERE field_key = 'anything_else';
