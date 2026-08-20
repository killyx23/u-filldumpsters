-- Compact Equipment Rental homepage card copy (service id 5).
-- Keep Mini Excavator as the bookable machine name.

UPDATE public.services
SET
  description = replace(description, 'Mini excavator rental', 'Strong machinery'),
  homepage_description = replace(homepage_description, 'Mini excavator rental', 'Strong machinery'),
  features = (
    SELECT jsonb_agg(
      CASE
        WHEN elem #>> '{}' IN (
          'You pick up & return',
          'You pick up & return or we have delivery available'
        )
        THEN to_jsonb('You pick up and you return or we have delivery available'::text)
        ELSE elem
      END
    )
    FROM jsonb_array_elements(COALESCE(features, '[]'::jsonb)) AS elem
  )
WHERE id = 5;
