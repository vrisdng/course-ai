-- Page images + citation highlights.
--
-- Each PDF page is rendered to course-materials/page-images/<material_id>/page-<n>.webp
-- by the Vercel renderer (api/render-pdf-pages.ts) during process-material-job.
-- material_pages records which pages have an image, its pixel size, and the
-- page's text lines with boxes; chunks.highlight_box is the chunk's box on its
-- page, matched from those lines. Boxes are [x0, y0, x1, y1] fractions of the
-- page (top-left origin), so they apply to the image at any display size.

CREATE TABLE IF NOT EXISTS public.material_pages (
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number >= 1),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (material_id, page_number)
);

ALTER TABLE public.material_pages ENABLE ROW LEVEL SECURITY;

-- Readable by whoever can read the material: the subquery runs under the
-- caller's own materials RLS, so access rules stay defined in one place.
-- Writes come only from the service role (process-material-job).
CREATE POLICY "Users can view pages of materials they can access"
ON public.material_pages FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.materials m WHERE m.id = material_pages.material_id)
);

ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS highlight_box jsonb;

-- Page images: same rule as material_pages, keyed by the material id folder.
CREATE POLICY "Users can view page images of materials they can access"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'course-materials'
  AND (storage.foldername(name))[1] = 'page-images'
  AND EXISTS (
    SELECT 1 FROM public.materials m
    WHERE m.id::text = (storage.foldername(name))[2]
  )
);

-- The thumbnail policies from 20260916000001 compared materials.file_path to
-- '<material_id>/page-<n>.png', which never matches; the thumbnail pipeline
-- they served is replaced by page-images above.
DROP POLICY IF EXISTS "Lecturers can upload thumbnail images" ON storage.objects;
DROP POLICY IF EXISTS "Enrolled users and lecturers can view thumbnail images" ON storage.objects;
