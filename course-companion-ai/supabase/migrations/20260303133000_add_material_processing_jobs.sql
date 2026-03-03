CREATE TABLE IF NOT EXISTS public.material_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status public.processing_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text NULL,
  locked_at timestamptz NULL,
  locked_by text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_processing_jobs_material_id_job_type_key UNIQUE (material_id, job_type)
);

CREATE INDEX IF NOT EXISTS material_processing_jobs_status_created_at_idx
  ON public.material_processing_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS material_processing_jobs_job_type_status_idx
  ON public.material_processing_jobs(job_type, status, created_at);

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
BEGIN
  RETURN QUERY
  WITH next_job AS (
    SELECT j.id
    FROM public.material_processing_jobs j
    WHERE j.job_type = requested_job_type
      AND (
        (requested_material_id IS NOT NULL AND j.material_id = requested_material_id AND j.status IN ('pending', 'failed'))
        OR
        (requested_material_id IS NULL AND j.status = 'pending')
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

GRANT EXECUTE ON FUNCTION public.claim_material_processing_job(text, uuid, text) TO authenticated;
