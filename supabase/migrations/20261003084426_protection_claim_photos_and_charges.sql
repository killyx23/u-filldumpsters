-- Proof photos and over-cap card charges for hardware protection claims.
-- amount_charged keeps a successful card charge when the claim amount is edited later.

ALTER TABLE public.protection_plan_claims
  ADD COLUMN IF NOT EXISTS proof_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS coverage_cap numeric(10, 2),
  ADD COLUMN IF NOT EXISTS covered_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS customer_charge_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS amount_charged numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charge_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text,
  ADD COLUMN IF NOT EXISTS charged_at timestamptz;

ALTER TABLE public.protection_plan_claims
  DROP CONSTRAINT IF EXISTS protection_plan_claims_charge_status_check;

ALTER TABLE public.protection_plan_claims
  ADD CONSTRAINT protection_plan_claims_charge_status_check
  CHECK (charge_status IN ('none', 'charged', 'failed'));
