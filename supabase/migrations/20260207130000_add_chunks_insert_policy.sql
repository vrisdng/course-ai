-- Allow users to insert chunks for materials they manage or their own documents
DROP POLICY IF EXISTS "Users can insert chunks" ON public.chunks;
CREATE POLICY "Users can insert chunks"
ON public.chunks FOR INSERT
TO authenticated
WITH CHECK (
  (
    material_id IS NOT NULL
    AND public.is_course_lecturer(auth.uid(), public.get_material_course_id(material_id))
  )
  OR
  (
    student_document_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.student_documents sd
      WHERE sd.id = student_document_id AND sd.user_id = auth.uid()
    )
  )
);
