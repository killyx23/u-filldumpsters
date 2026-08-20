-- Finish the customer-facing rename: Compact Equipment → Compact Equipment Rental.
-- Do not change Mini Excavator or Mini Telescoping Loader machine names.

UPDATE public.services
SET name = 'Compact Equipment Rental'
WHERE name = 'Compact Equipment';

UPDATE public.bookings
SET plan = jsonb_set(plan, '{name}', to_jsonb('Compact Equipment Rental'::text))
WHERE plan->>'name' IN ('Compact Equipment', 'DIY Heavy Equipment');

UPDATE public.pending_customers
SET plan_data = jsonb_set(plan_data, '{name}', to_jsonb('Compact Equipment Rental'::text))
WHERE plan_data->>'name' IN ('Compact Equipment', 'DIY Heavy Equipment');
