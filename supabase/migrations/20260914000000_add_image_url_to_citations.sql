-- Allow chat answers to embed image citations from image-typed course materials.
-- image_url stores a stable "<bucket>/<file_path>" reference (e.g.
-- "course-materials/abc-lecture.png"), never a signed/short-lived URL, so the
-- markdown embedded in a message stays valid across sessions. The frontend
-- resolves the live URL on demand via the signed-media edge function after
-- verifying course access with the user's own (RLS-bound) credentials.
ALTER TABLE public.citations
  ADD COLUMN IF NOT EXISTS image_url TEXT;
