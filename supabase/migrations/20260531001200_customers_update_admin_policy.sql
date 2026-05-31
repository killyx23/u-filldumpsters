-- Allow authenticated admins to update customer records.
-- Keeps customer self-update policy intact while restoring admin write access.
DROP POLICY IF EXISTS "customers_update_admin" ON public.customers;

CREATE POLICY "customers_update_admin"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
