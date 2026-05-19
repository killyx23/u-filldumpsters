-- Remove debug/permissive verification-documents policies from remote_schema pull;
-- restore scoped policies for guest booking uploads.

DROP POLICY IF EXISTS "TEMP_DEBUG_ALLOW_ALL_STORAGE" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes to verification-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to verification-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to verification-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read for verification-documents" ON storage.objects;

DROP POLICY IF EXISTS "verification_documents_public_read" ON storage.objects;
DROP POLICY IF EXISTS "verification_documents_insert" ON storage.objects;
DROP POLICY IF EXISTS "verification_documents_update" ON storage.objects;
DROP POLICY IF EXISTS "verification_documents_admin_all" ON storage.objects;

CREATE POLICY "verification_documents_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'verification-documents');

CREATE POLICY "verification_documents_insert"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'verification-documents'
  AND (storage.foldername(name))[1] = 'customers'
  AND (storage.foldername(name))[3] = 'verification'
  AND (
    (storage.foldername(name))[2] LIKE 'unassigned-%'
    OR public.is_admin()
    OR (
      auth.role() = 'authenticated'
      AND (storage.foldername(name))[2] IN (
        SELECT id::text FROM public.customers WHERE user_id = auth.uid()
      )
    )
  )
);

CREATE POLICY "verification_documents_update"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (
  bucket_id = 'verification-documents'
  AND (storage.foldername(name))[1] = 'customers'
  AND (storage.foldername(name))[3] = 'verification'
  AND (
    (storage.foldername(name))[2] LIKE 'unassigned-%'
    OR public.is_admin()
    OR (
      auth.role() = 'authenticated'
      AND (storage.foldername(name))[2] IN (
        SELECT id::text FROM public.customers WHERE user_id = auth.uid()
      )
    )
  )
)
WITH CHECK (
  bucket_id = 'verification-documents'
  AND (storage.foldername(name))[1] = 'customers'
  AND (storage.foldername(name))[3] = 'verification'
  AND (
    (storage.foldername(name))[2] LIKE 'unassigned-%'
    OR public.is_admin()
    OR (
      auth.role() = 'authenticated'
      AND (storage.foldername(name))[2] IN (
        SELECT id::text FROM public.customers WHERE user_id = auth.uid()
      )
    )
  )
);

CREATE POLICY "verification_documents_admin_all"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'verification-documents' AND public.is_admin())
WITH CHECK (bucket_id = 'verification-documents' AND public.is_admin());
