-- Keep the source and selected transcript rows with each citation. Publishing a
-- new transcription replaces both chunks and transcript rows; old chats must
-- not lose their citations through the chunk foreign key cascade.
ALTER TABLE public.citations
  ADD COLUMN material_id uuid REFERENCES public.materials(id) ON DELETE CASCADE,
  ADD COLUMN student_document_id uuid REFERENCES public.student_documents(id) ON DELETE CASCADE,
  ADD COLUMN page_number integer,
  ADD COLUMN start_ms bigint,
  ADD COLUMN end_ms bigint,
  ADD COLUMN evidence_segments jsonb;

UPDATE public.citations AS citation
SET material_id = chunk.material_id,
    student_document_id = chunk.student_document_id,
    page_number = chunk.page_number,
    start_ms = chunk.start_ms,
    end_ms = chunk.end_ms
FROM public.chunks AS chunk
WHERE citation.chunk_id = chunk.id;

ALTER TABLE public.citations ALTER COLUMN chunk_id DROP NOT NULL;
ALTER TABLE public.citations DROP CONSTRAINT citations_chunk_id_fkey;
ALTER TABLE public.citations
  ADD CONSTRAINT citations_chunk_id_fkey
  FOREIGN KEY (chunk_id) REFERENCES public.chunks(id) ON DELETE SET NULL;

ALTER TABLE public.citations
  ADD CONSTRAINT citations_evidence_segments_array
  CHECK (evidence_segments IS NULL OR jsonb_typeof(evidence_segments) = 'array');
