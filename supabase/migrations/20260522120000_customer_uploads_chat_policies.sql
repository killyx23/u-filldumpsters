-- Storage RLS for customer-uploads bucket (chat attachments, verification files, etc.)

DROP POLICY IF EXISTS "customer_uploads_admin_all" ON storage.objects;
CREATE POLICY "customer_uploads_admin_all"
  ON storage.objects
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (bucket_id = 'customer-uploads' AND public.is_admin())
  WITH CHECK (bucket_id = 'customer-uploads' AND public.is_admin());

DROP POLICY IF EXISTS "customer_uploads_chat_insert" ON storage.objects;
CREATE POLICY "customer_uploads_chat_insert"
  ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'customer-uploads'
    AND (storage.foldername(name))[1] = 'chat-attachments'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.customers WHERE user_id = auth.uid()
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
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.customers WHERE user_id = auth.uid()
    )
  );

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
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.customers WHERE user_id = auth.uid()
    )
  );
