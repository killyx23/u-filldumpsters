-- Rental insurance / damage waiver is taxable unless explicitly exempted in admin Tax Calculations.
ALTER TABLE public.protection_plans
  ALTER COLUMN is_taxable SET DEFAULT true;

UPDATE public.protection_plans
SET is_taxable = true
WHERE plan_type = 'rental_insurance'
   OR plan_key IN ('premium_insurance', 'rental_insurance');
