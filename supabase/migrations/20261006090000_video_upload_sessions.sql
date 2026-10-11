-- Video bytes are uploaded directly to private Storage after an authorized
-- material reservation exists. The upload key makes retries safe across reloads.
ALTER TABLE public.materials
  ADD COLUMN video_upload_key uuid,
  ADD COLUMN video_content_type text,
  ADD COLUMN video_upload_state text;

ALTER TABLE public.materials
  ADD CONSTRAINT materials_video_upload_state_check
  CHECK (video_upload_state IS NULL OR video_upload_state IN ('uploading', 'uploaded', 'cancelled', 'deleting'));

CREATE UNIQUE INDEX materials_video_uploader_upload_key_unique
  ON public.materials (uploaded_by, video_upload_key)
  WHERE video_upload_key IS NOT NULL;

CREATE UNIQUE INDEX materials_video_storage_path_unique
  ON public.materials (file_path)
  WHERE file_type = 'video' AND file_path LIKE 'videos/%';

-- Cleanup intent survives material deletion. A TUS request that was already
-- authorized can finish after cancellation; the sweeper removes that object
-- repeatedly until the old upload URL has safely expired.
CREATE TABLE public.video_storage_cleanup (
  file_path text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_cleanup_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);
ALTER TABLE public.video_storage_cleanup ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_storage_cleanup TO service_role;
CREATE INDEX video_storage_cleanup_due_idx
  ON public.video_storage_cleanup (next_cleanup_at);

-- Read Storage's system metadata rather than downloading up to 3 GB into an
-- Edge Function. Only the service role may call this verification helper.
CREATE FUNCTION public.get_video_storage_object_info(target_path text)
RETURNS TABLE (size_bytes bigint, content_type text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (o.metadata->>'size')::bigint AS size_bytes,
    o.metadata->>'mimetype' AS content_type
  FROM storage.objects o
  WHERE o.bucket_id = 'course-materials'
    AND o.name = target_path
    AND target_path LIKE 'videos/%'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_video_storage_object_info(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_storage_object_info(text) TO service_role;

-- Supabase's project-wide maximum must also be at least 3,000,000,000 bytes.
-- A bucket limit cannot override a lower project-wide maximum.
UPDATE storage.buckets
SET file_size_limit = 3000000000
WHERE id = 'course-materials';

-- Existing documents keep their prior policy. In the reserved videos/ namespace,
-- a TUS INSERT must correspond to the caller's still-pending material row.
CREATE POLICY "Reserved video uploads require own pending material"
ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  bucket_id <> 'course-materials'
  OR name !~ '^videos/'
  OR EXISTS (
    SELECT 1
    FROM public.materials m
    JOIN public.profiles p ON p.id = m.uploaded_by
    WHERE m.file_path = name
      AND m.file_type = 'video'
      AND m.video_upload_state = 'uploading'
      AND p.user_id = auth.uid()
  )
);

-- A completed TUS upload is not available to other course members until the
-- server verifies the final object size and marks the material uploaded.
CREATE POLICY "Pending video uploads are visible only to uploader"
ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  bucket_id <> 'course-materials'
  OR name !~ '^videos/'
  OR EXISTS (
    SELECT 1
    FROM public.materials m
    JOIN public.profiles p ON p.id = m.uploaded_by
    WHERE m.file_path = name
      AND (
        m.video_upload_state = 'uploaded'
        OR m.video_upload_state IS NULL
        OR (m.video_upload_state = 'uploading' AND p.user_id = auth.uid())
      )
  )
);
