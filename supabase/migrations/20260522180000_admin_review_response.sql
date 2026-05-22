-- Add official admin response fields to reviews and allow response media public reads.

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS admin_response_text text,
  ADD COLUMN IF NOT EXISTS admin_response_image_urls jsonb,
  ADD COLUMN IF NOT EXISTS admin_response_video_url text,
  ADD COLUMN IF NOT EXISTS admin_response_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_response_updated_by uuid;

COMMENT ON COLUMN public.reviews.admin_response_text IS 'Official U-Fill Dumpsters response shown under a customer review.';
COMMENT ON COLUMN public.reviews.admin_response_image_urls IS 'Storage paths for optional images attached to the official review response.';
COMMENT ON COLUMN public.reviews.admin_response_video_url IS 'Storage path for optional video attached to the official review response.';
COMMENT ON COLUMN public.reviews.admin_response_updated_at IS 'Timestamp of the latest official review response update.';
COMMENT ON COLUMN public.reviews.admin_response_updated_by IS 'Auth user id of the admin who last updated the official review response.';

DROP POLICY IF EXISTS "customer_uploads_review_media_select" ON storage.objects;
CREATE POLICY "customer_uploads_review_media_select"
  ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    bucket_id = 'customer-uploads'
    AND (storage.foldername(name))[2] IN (
      'review-images',
      'review-videos',
      'review-response-images',
      'review-response-videos'
    )
  );
