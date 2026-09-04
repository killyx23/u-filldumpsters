-- Ensure private customer-uploads bucket exists (local DBs may skip seed).
-- Keep private: damage photos are served via signed URLs, not public object routes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-uploads',
  'customer-uploads',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;
