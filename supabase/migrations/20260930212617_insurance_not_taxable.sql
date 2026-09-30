-- Premium insurance is not subject to sales tax (matches legacy services.id = 7).
UPDATE public.protection_plans
SET
  is_taxable = false,
  updated_at = timezone('utc', now())
WHERE plan_key = 'premium_insurance'
  AND is_taxable IS DISTINCT FROM false;
