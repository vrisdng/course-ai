-- Video processing is separate from short-lived document workers: waiting for
-- AssemblyAI may take hours, whereas document worker leases last minutes.
CREATE TABLE public.video_transcription_jobs (
  material_id uuid PRIMARY KEY REFERENCES public.materials(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending', 'submitting', 'submission_unknown', 'waiting', 'staging', 'indexing', 'completed', 'failed')),
  retry_status text NOT NULL DEFAULT 'pending' CHECK (retry_status IN ('pending', 'waiting', 'staging', 'indexing')),
  provider_transcript_id text UNIQUE,
  duration_ms bigint,
  language text,
  stage_source text NOT NULL DEFAULT 'provider' CHECK (stage_source IN ('provider', 'existing')),
  stage_segment_cursor integer NOT NULL DEFAULT 0,
  stage_chunk_cursor integer NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX video_transcription_jobs_due_idx ON public.video_transcription_jobs(status, next_check_at);
ALTER TABLE public.video_transcription_jobs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.video_transcription_jobs TO service_role;

-- A separate staging index keeps the old transcript and RAG chunks usable until
-- the replacement is fully embedded. Only the service role accesses these rows.
CREATE TABLE public.video_transcript_segments_staging (
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  segment_index integer NOT NULL,
  start_ms bigint NOT NULL,
  end_ms bigint NOT NULL,
  text text NOT NULL,
  confidence numeric,
  speaker_label text,
  PRIMARY KEY (material_id, segment_index)
);
ALTER TABLE public.video_transcript_segments_staging ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.video_transcript_segments_staging TO service_role;

CREATE TABLE public.video_chunks_staging (
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  chunk_text text NOT NULL,
  start_ms bigint NOT NULL,
  end_ms bigint NOT NULL,
  embedding_openai extensions.vector(3072),
  PRIMARY KEY (material_id, chunk_index)
);
CREATE INDEX video_chunks_staging_unembedded_idx ON public.video_chunks_staging(material_id, chunk_index)
  WHERE embedding_openai IS NULL;
ALTER TABLE public.video_chunks_staging ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.video_chunks_staging TO service_role;

-- Exactly one invocation may submit a video to the provider. A crash after the
-- provider accepts but before saving its ID leaves `submitting`; recovery marks
-- that uncertain outcome instead of automatically incurring a duplicate charge.
CREATE FUNCTION public.claim_video_transcription_submission(p_material_id uuid)
RETURNS TABLE (claimed boolean, current_status text, transcript_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.video_transcription_jobs;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id = p_material_id AND video_upload_state = 'uploaded') THEN
    RAISE EXCEPTION 'video material is not uploaded';
  END IF;
  INSERT INTO public.video_transcription_jobs(material_id) VALUES (p_material_id)
    ON CONFLICT (material_id) DO NOTHING;
  SELECT * INTO j FROM public.video_transcription_jobs WHERE material_id = p_material_id FOR UPDATE;
  IF j.status = 'pending' THEN
    UPDATE public.video_transcription_jobs SET status = 'submitting',
      attempt_count = attempt_count + 1, updated_at = now()
      WHERE material_id = p_material_id;
    RETURN QUERY SELECT true, 'submitting'::text, NULL::text;
  ELSE
    RETURN QUERY SELECT false, j.status, j.provider_transcript_id;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.claim_video_transcription_submission(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_transcription_submission(uuid) TO service_role;

-- Explicit admin retry is allowed only after a known failure. An uncertain
-- submission must be investigated before risking a duplicate provider charge.
CREATE FUNCTION public.retry_failed_video_transcription(p_material_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id = p_material_id AND video_upload_state = 'uploaded') THEN
    RAISE EXCEPTION 'video material is not uploaded';
  END IF;
  UPDATE public.video_transcription_jobs SET status = retry_status,
    provider_transcript_id = CASE WHEN retry_status = 'pending' THEN NULL ELSE provider_transcript_id END,
    attempt_count = 0, last_error = NULL,
    stage_source = CASE WHEN retry_status = 'pending' THEN 'provider' ELSE stage_source END,
    stage_segment_cursor = CASE WHEN retry_status = 'pending' THEN 0 ELSE stage_segment_cursor END,
    stage_chunk_cursor = CASE WHEN retry_status = 'pending' THEN 0 ELSE stage_chunk_cursor END,
    next_check_at = now(), locked_until = NULL, updated_at = now()
    WHERE material_id = p_material_id AND status = 'failed';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.materials SET external_transcript_id = (
      SELECT provider_transcript_id FROM public.video_transcription_jobs WHERE material_id = p_material_id
    ),
    processing_status = 'pending', processing_stage = (
      SELECT CASE retry_status WHEN 'indexing' THEN 'embedding' WHEN 'staging' THEN 'chunking' ELSE 'transcribing' END
      FROM public.video_transcription_jobs WHERE material_id = p_material_id
    ),
    processing_progress = 25, processing_error = NULL
    WHERE id = p_material_id;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.retry_failed_video_transcription(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_failed_video_transcription(uuid) TO service_role;

-- Publishes provider ID and material state in one transaction.
CREATE FUNCTION public.record_video_transcription_submission(p_material_id uuid, p_transcript_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id = p_material_id AND video_upload_state = 'uploaded') THEN
    RAISE EXCEPTION 'video material is not uploaded';
  END IF;
  UPDATE public.video_transcription_jobs SET status = 'waiting',
    provider_transcript_id = p_transcript_id, next_check_at = now() + interval '30 seconds',
    updated_at = now() WHERE material_id = p_material_id AND status = 'submitting';
  IF NOT FOUND THEN RAISE EXCEPTION 'video submission state changed'; END IF;
  UPDATE public.materials SET external_transcript_id = p_transcript_id,
    processing_status = 'processing', processing_stage = 'transcribing',
    processing_progress = 35, processing_error = NULL
    WHERE id = p_material_id;
END; $$;
REVOKE ALL ON FUNCTION public.record_video_transcription_submission(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_transcription_submission(uuid,text) TO service_role;

CREATE FUNCTION public.claim_due_video_transcription_job()
RETURNS SETOF public.video_transcription_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  WITH due AS (
    SELECT material_id FROM public.video_transcription_jobs
    WHERE status IN ('waiting', 'staging', 'indexing') AND next_check_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY next_check_at LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.video_transcription_jobs j SET locked_until = now() + interval '5 minutes',
    updated_at = now() FROM due WHERE j.material_id = due.material_id RETURNING j.*;
END; $$;
REVOKE ALL ON FUNCTION public.claim_due_video_transcription_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_video_transcription_job() TO service_role;

-- Replacement rows become visible atomically. A failed embedding run never
-- deletes the current working transcript/index.
CREATE FUNCTION public.publish_video_transcript(p_material_id uuid, p_duration_ms bigint, p_language text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id = p_material_id
    AND (video_upload_state = 'uploaded' OR (video_upload_state IS NULL AND file_path = '')) FOR UPDATE) THEN
    RAISE EXCEPTION 'video material is not uploaded';
  END IF;
  PERFORM 1 FROM public.video_transcription_jobs
    WHERE material_id = p_material_id AND status = 'indexing' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'video job is not indexing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.video_chunks_staging WHERE material_id = p_material_id)
     OR EXISTS (SELECT 1 FROM public.video_chunks_staging
       WHERE material_id = p_material_id AND embedding_openai IS NULL) THEN
    RAISE EXCEPTION 'video index incomplete';
  END IF;

  DELETE FROM public.material_transcript_segments WHERE material_id = p_material_id;
  INSERT INTO public.material_transcript_segments
    (material_id,segment_index,start_ms,end_ms,text,confidence,speaker_label)
    SELECT material_id,segment_index,start_ms,end_ms,text,confidence,speaker_label
    FROM public.video_transcript_segments_staging WHERE material_id = p_material_id ORDER BY segment_index;
  DELETE FROM public.chunks WHERE material_id = p_material_id;
  INSERT INTO public.chunks
    (material_id,chunk_index,chunk_text,embedding_openai,start_position,end_position,start_ms,end_ms,page_number)
    SELECT material_id,chunk_index,chunk_text,embedding_openai,0,length(chunk_text),start_ms,end_ms,NULL
    FROM public.video_chunks_staging WHERE material_id = p_material_id ORDER BY chunk_index;
  UPDATE public.materials SET processing_status = 'completed', processing_stage = 'completed',
    processing_progress = 100, processing_error = NULL, duration_ms = p_duration_ms,
    transcription_provider = 'assemblyai', transcription_language = p_language
    WHERE id = p_material_id;
  UPDATE public.video_transcription_jobs SET status = 'completed', locked_until = NULL,
    last_error = NULL, updated_at = now() WHERE material_id = p_material_id;
  DELETE FROM public.video_transcript_segments_staging WHERE material_id = p_material_id;
  DELETE FROM public.video_chunks_staging WHERE material_id = p_material_id;
END; $$;
REVOKE ALL ON FUNCTION public.publish_video_transcript(uuid,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_video_transcript(uuid,bigint,text) TO service_role;
