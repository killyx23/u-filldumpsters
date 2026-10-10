ALTER TABLE public.protection_plan_claims
  ADD COLUMN IF NOT EXISTS received_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_notified_at timestamptz;

ALTER TABLE public.customer_notes
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

DROP POLICY IF EXISTS "Customers read own protection_plan_claims" ON public.protection_plan_claims;
CREATE POLICY "Customers read own protection_plan_claims"
  ON public.protection_plan_claims FOR SELECT
  USING (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );

GRANT SELECT ON public.protection_plan_claims TO authenticated;
