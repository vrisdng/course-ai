-- Phase 1 of the Cloudflare R2 video migration (see
-- docs/scratchpad/cloudflare-r2-video-migration-plan.md).
--
-- Video storage is moving from private Supabase Storage to private Cloudflare R2.
-- This migration keeps the schema storage-provider-agnostic WITHOUT changing the
-- current Supabase Storage behaviour: storage_provider defaults to 'supabase', a
-- durable multipart-upload ledger is added for R2 resumable uploads, and the
-- cleanup ledger gains the columns R2 needs to finish or abort an interrupted
-- multipart upload. Existing rows, policies, and the Supabase Storage helper are
-- left untouched; nothing here is enforced until storage_provider is 'r2'.

-- 1. Which provider stores a given video. 'supabase' preserves current behaviour
--    and is the default, so the unchanged Supabase upload path keeps working.
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'supabase';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'materials_storage_provider_check'
  ) THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_storage_provider_check
      CHECK (storage_provider IN ('supabase', 'r2'));
  END IF;
END
$$;

-- 2. Durable state for an in-progress R2 multipart upload. The server (not the
--    browser) is the source of truth, so an interrupted transfer can resume its
--    accepted parts after a reload or device change.
CREATE TABLE IF NOT EXISTS public.materials_multipart_uploads (
  material_id uuid PRIMARY KEY REFERENCES public.materials(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  r2_upload_id text NOT NULL,
  part_size_bytes bigint NOT NULL,
  state text NOT NULL DEFAULT 'in_progress'
    CONSTRAINT materials_multipart_state_check
    CHECK (state IN ('in_progress', 'completed', 'aborted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.materials_multipart_uploads ENABLE ROW LEVEL SECURITY;
-- service_role bypasses RLS; this lets the browser inspect its own upload only.
CREATE POLICY "Own multipart uploads are selectable by the uploader"
  ON public.materials_multipart_uploads AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materials m
      JOIN public.profiles p ON p.id = m.uploaded_by
      WHERE m.id = material_id AND p.user_id = auth.uid()
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materials_multipart_uploads TO service_role;

-- 3. The cleanup ledger also records R2 unfinished multipart uploads so an
--    interrupted upload is aborted (not left orphaned) after cancellation.
ALTER TABLE public.video_storage_cleanup
  ADD COLUMN IF NOT EXISTS storage_provider text,
  ADD COLUMN IF NOT EXISTS object_key text,
  ADD COLUMN IF NOT EXISTS r2_multipart_upload_id text;
