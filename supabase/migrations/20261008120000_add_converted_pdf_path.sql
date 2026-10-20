-- DOCX/PPTX → PDF conversion.
--
-- process-material-job converts Word/PowerPoint uploads to PDF with the office
-- converter (services/office-converter) and runs the PDF through the normal
-- PDF pipeline. The original stays at materials.file_path; the PDF is stored
-- at course-materials/converted/<material_id>.pdf and recorded here so the
-- citation viewer can show it (and its page images) instead of the original.

ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS converted_pdf_path text;

-- Readable by whoever can read the material: the subquery runs under the
-- caller's own materials RLS. Writes come only from the service role.
CREATE POLICY "Users can view converted PDFs of materials they can access"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'course-materials'
  AND (storage.foldername(name))[1] = 'converted'
  AND EXISTS (
    SELECT 1 FROM public.materials m
    WHERE m.converted_pdf_path = storage.objects.name
  )
);
