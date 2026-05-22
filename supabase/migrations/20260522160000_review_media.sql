-- Review media: video_url column, bucket video support, public read for review media paths

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS video_url text;

COMMENT ON COLUMN public.reviews.video_url IS 'Storage path in customer-uploads bucket for optional video review';

-- Allow video uploads and raise size limit for customer-uploads bucket
UPDATE storage.buckets
SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v',
    'video/3gpp'
  ]::text[]
WHERE id = 'customer-uploads';

-- Public read for review media (paths only exposed via approved reviews in DB)
DROP POLICY IF EXISTS "customer_uploads_review_media_select" ON storage.objects;
CREATE POLICY "customer_uploads_review_media_select"
  ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    bucket_id = 'customer-uploads'
    AND (storage.foldername(name))[2] IN ('review-images', 'review-videos')
  );
