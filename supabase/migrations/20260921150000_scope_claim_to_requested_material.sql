-- Fix: a worker triggered for a specific material could claim an unrelated
-- stale job instead. The previous WHERE clause OR'd the stale-reclaim branch
-- in unconditionally and ORDER BY created_at then preferred the oldest row,
-- so every trigger for a new upload re-ran whichever old job was stuck and
-- the new upload's job was never touched.
--
-- Now:
--   * requested_material_id set  -> only that material's job (pending, failed,
--     or its own stale processing lock) is eligible.
--   * requested_material_id null -> general poll: pending jobs first, then
--     stale processing jobs, oldest first within each group.
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
        (
          requested_material_id IS NOT NULL
          AND j.material_id = requested_material_id
          AND (
            j.status IN ('pending', 'failed')
            OR (
              j.status = 'processing'
              AND j.locked_at < now() - (stale_threshold_minutes || ' minutes')::interval
            )
          )
        )
        OR
        (
          requested_material_id IS NULL
          AND (
            j.status = 'pending'
            OR (
              j.status = 'processing'
              AND j.locked_at < now() - (stale_threshold_minutes || ' minutes')::interval
            )
          )
        )
      )
    ORDER BY (j.status = 'pending') DESC, j.created_at
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
