-- Harden customer-uploads storage policies for chat attachments and verification uploads.
-- Allows customer uploads when customers.user_id matches OR JWT customer_db_id matches path folder.
-- Allows admin uploads via is_admin() or user_roles.

DROP POLICY IF EXISTS "customer_uploads_admin_all" ON storage.objects;
CREATE POLICY "customer_uploads_admin_all"
  ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'customer-uploads'
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'admin'
      )
    )
  )
  WITH CHECK (
    bucket_id = 'customer-uploads'
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'admin'
      )
    )
  );

DROP POLICY IF EXISTS "customer_uploads_chat_insert" ON storage.objects;
CREATE POLICY "customer_uploads_chat_insert"
  ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'customer-uploads'
    AND (storage.foldername(name))[1] = 'chat-attachments'
    AND (
      (storage.foldername(name))[2] IN (
        SELECT id::text FROM public.customers WHERE user_id = auth.uid()
      )
      OR (
        NULLIF(auth.jwt() -> 'user_metadata' ->> 'customer_db_id', '') IS NOT NULL
        AND (storage.foldername(name))[2] = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')
      )
    )
  );

DROP POLICY IF EXISTS "customer_uploads_customer_folder_insert" ON storage.objects;
CREATE POLICY "customer_uploads_customer_folder_insert"
  ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'customer-uploads'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.customers WHERE user_id = auth.uid()
      )
      OR (
        NULLIF(auth.jwt() -> 'user_metadata' ->> 'customer_db_id', '') IS NOT NULL
        AND (storage.foldername(name))[1] = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')
      )
    )
  );

-- SELECT policies unchanged if present; recreate for idempotency
DROP POLICY IF EXISTS "customer_uploads_chat_select" ON storage.objects;
CREATE POLICY "customer_uploads_chat_select"
  ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    bucket_id = 'customer-uploads'
    AND (storage.foldername(name))[1] = 'chat-attachments'
  );

DROP POLICY IF EXISTS "customer_uploads_customer_select" ON storage.objects;
CREATE POLICY "customer_uploads_customer_select"
  ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'customer-uploads'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.customers WHERE user_id = auth.uid()
      )
      OR (
        NULLIF(auth.jwt() -> 'user_metadata' ->> 'customer_db_id', '') IS NOT NULL
        AND (storage.foldername(name))[1] = (auth.jwt() -> 'user_metadata' ->> 'customer_db_id')
      )
    )
  );
