-- Add thumbnail_path column to materials table for storing page thumbnail images
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

-- Storage policies for thumbnail images
CREATE POLICY "Lecturers can upload thumbnail images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'course-materials'
  AND (storage.foldername(name))[1] = 'thumbnails'
  AND EXISTS (
    SELECT 1 FROM materials
    WHERE file_path = (storage.foldername(name))[2] || '/' || (storage.filename(name))
    AND uploaded_by = auth.uid()
  )
);

CREATE POLICY "Enrolled users and lecturers can view thumbnail images"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'course-materials'
  AND (storage.foldername(name))[1] = 'thumbnails'
  AND (
    EXISTS (
      SELECT 1 FROM materials
      WHERE file_path = (storage.foldername(name))[2] || '/' || (storage.filename(name))
      AND course_id IN (
        SELECT course_id FROM enrollments WHERE user_id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM materials
      WHERE file_path = (storage.foldername(name))[2] || '/' || (storage.filename(name))
      AND uploaded_by = auth.uid()
    )
  )
);
