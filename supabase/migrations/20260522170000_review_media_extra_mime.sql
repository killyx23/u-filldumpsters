-- Additional video MIME types reported by some mobile browsers

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
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
