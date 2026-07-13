-- 1. Replace claim function: add max_attempts guard (5) and support claiming
--    'pending' jobs as before, but also auto-reclaim stale 'processing' jobs
--    whose lock is older than stale_threshold_minutes.
CREATE OR REPLACE FUNCTION public.claim_material_processing_job(
  worker_id text,
  requested_material_id uuid DEFAULT NULL,
  requested_job_type text DEFAULT 'parse_document'
)
RETURNS SETOF public.material_processing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_attempts constant integer := 5;
  stale_threshold_minutes constant integer := 5;
BEGIN
  RETURN QUERY
  WITH next_job AS (
    SELECT j.id
    FROM public.material_processing_jobs j
    WHERE j.job_type = requested_job_type
      AND j.attempt_count < max_attempts
      AND (
        -- Specific material requested: claim pending or failed
        (requested_material_id IS NOT NULL
         AND j.material_id = requested_material_id
         AND j.status IN ('pending', 'failed'))
        OR
        -- General poll: claim pending
        (requested_material_id IS NULL AND j.status = 'pending')
        OR
        -- Auto-reclaim stale processing jobs (lock expired)
        (j.status = 'processing'
         AND j.locked_at < now() - (stale_threshold_minutes || ' minutes')::interval)
      )
    ORDER BY j.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.material_processing_jobs job
  SET
    status = 'processing',
    attempt_count = job.attempt_count + 1,
    last_error = NULL,
    locked_at = now(),
    locked_by = worker_id,
    updated_at = now()
  FROM next_job
  WHERE job.id = next_job.id
  RETURNING job.*;
END;
$$;

-- 2. Scheduled reaper: resets stale processing jobs to pending so they can be
--    re-claimed. Also marks jobs that exceeded max attempts as failed.
CREATE OR REPLACE FUNCTION public.reap_stale_material_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_attempts constant integer := 5;
  stale_threshold_minutes constant integer := 5;
  reaped integer := 0;
BEGIN
  -- Fail jobs that exceeded max attempts
  UPDATE public.material_processing_jobs
  SET
    status = 'failed',
    last_error = 'Exceeded maximum retry attempts (' || max_attempts || ')',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now()
  WHERE status IN ('processing', 'pending')
    AND attempt_count >= max_attempts;

  -- Reset stale processing jobs to pending (so claim can pick them up)
  WITH reaped_jobs AS (
    UPDATE public.material_processing_jobs
    SET
      status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
    WHERE status = 'processing'
      AND locked_at < now() - (stale_threshold_minutes || ' minutes')::interval
      AND attempt_count < max_attempts
    RETURNING id
  )
  SELECT count(*) INTO reaped FROM reaped_jobs;

  RETURN reaped;
END;
$$;

-- Grant execute to service role (edge functions use service role key)
GRANT EXECUTE ON FUNCTION public.reap_stale_material_jobs() TO service_role;
