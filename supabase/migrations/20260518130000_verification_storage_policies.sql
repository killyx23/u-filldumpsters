-- Storage RLS for verification-documents bucket (license uploads during booking)

-- Public read (bucket is public; needed for SELECT policy when RLS is enabled)
CREATE POLICY "verification_documents_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'verification-documents');

-- Guest booking flow: customers/unassigned-{timestamp}/verification/*
-- Authenticated customers: customers/{customer_id}/verification/*
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

-- Required for upsert: true uploads in verificationImageHelper
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

-- Admin can delete/replace verification files
CREATE POLICY "verification_documents_admin_all"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'verification-documents' AND public.is_admin())
WITH CHECK (bucket_id = 'verification-documents' AND public.is_admin());
