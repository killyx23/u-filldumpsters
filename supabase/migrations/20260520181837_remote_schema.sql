-- Policy and trigger sync from db pull (May 2026).
-- Loyalty DROP statements from the original pull were removed: production had not
-- yet included loyalty when pull ran, so the diff incorrectly dropped local tables.
-- Keep loyalty via 20260519120000_loyalty_and_referrals.sql (and restore migration on prod if needed).

DROP POLICY IF EXISTS "public_insert_pending_customers" ON public.pending_customers;
CREATE POLICY "public_insert_pending_customers"
  ON public.pending_customers
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "public_select_pending_customers" ON public.pending_customers;
CREATE POLICY "public_select_pending_customers"
  ON public.pending_customers
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "public_update_pending_customers" ON public.pending_customers;
CREATE POLICY "public_update_pending_customers"
  ON public.pending_customers
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_deleted_users();

DROP POLICY IF EXISTS "Admin write resource-covers" ON storage.objects;
CREATE POLICY "Admin write resource-covers"
  ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((bucket_id = 'resource-covers'::text));

DROP POLICY IF EXISTS "Admin write resource-files" ON storage.objects;
CREATE POLICY "Admin write resource-files"
  ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((bucket_id = 'resource-files'::text));

DROP POLICY IF EXISTS "Admin write resource-pdfs" ON storage.objects;
CREATE POLICY "Admin write resource-pdfs"
  ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((bucket_id = 'resource-pdfs'::text));

DROP POLICY IF EXISTS "Public read resource-covers" ON storage.objects;
CREATE POLICY "Public read resource-covers"
  ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((bucket_id = 'resource-covers'::text));

DROP POLICY IF EXISTS "Public read resource-files" ON storage.objects;
CREATE POLICY "Public read resource-files"
  ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((bucket_id = 'resource-files'::text));

DROP POLICY IF EXISTS "Public read resource-pdfs" ON storage.objects;
CREATE POLICY "Public read resource-pdfs"
  ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((bucket_id = 'resource-pdfs'::text));

DROP POLICY IF EXISTS "verification_documents_admin_all" ON storage.objects;
CREATE POLICY "verification_documents_admin_all"
  ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((bucket_id = 'verification-documents'::text) AND public.is_admin()))
  WITH CHECK (((bucket_id = 'verification-documents'::text) AND public.is_admin()));

DROP POLICY IF EXISTS "verification_documents_insert" ON storage.objects;
CREATE POLICY "verification_documents_insert"
  ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (bucket_id = 'verification-documents'::text)
    AND (storage.foldername(name))[1] = 'customers'::text
    AND (storage.foldername(name))[3] = 'verification'::text
    AND (
      (storage.foldername(name))[2] ~~ 'unassigned-%'::text
      OR public.is_admin()
      OR (
        auth.role() = 'authenticated'::text
        AND (storage.foldername(name))[2] IN (
          SELECT customers.id::text
          FROM public.customers
          WHERE customers.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "verification_documents_public_read" ON storage.objects;
CREATE POLICY "verification_documents_public_read"
  ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((bucket_id = 'verification-documents'::text));

DROP POLICY IF EXISTS "verification_documents_update" ON storage.objects;
CREATE POLICY "verification_documents_update"
  ON storage.objects
  AS PERMISSIVE
  FOR UPDATE
  TO anon, authenticated
  USING (
    (bucket_id = 'verification-documents'::text)
    AND (storage.foldername(name))[1] = 'customers'::text
    AND (storage.foldername(name))[3] = 'verification'::text
    AND (
      (storage.foldername(name))[2] ~~ 'unassigned-%'::text
      OR public.is_admin()
      OR (
        auth.role() = 'authenticated'::text
        AND (storage.foldername(name))[2] IN (
          SELECT customers.id::text
          FROM public.customers
          WHERE customers.user_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    (bucket_id = 'verification-documents'::text)
    AND (storage.foldername(name))[1] = 'customers'::text
    AND (storage.foldername(name))[3] = 'verification'::text
    AND (
      (storage.foldername(name))[2] ~~ 'unassigned-%'::text
      OR public.is_admin()
      OR (
        auth.role() = 'authenticated'::text
        AND (storage.foldername(name))[2] IN (
          SELECT customers.id::text
          FROM public.customers
          WHERE customers.user_id = auth.uid()
        )
      )
    )
  );
