ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS processing_stage text,
  ADD COLUMN IF NOT EXISTS processing_progress integer;

UPDATE public.materials
SET
  processing_stage = CASE
    WHEN processing_status = 'completed' THEN 'completed'
    WHEN processing_status = 'failed' THEN 'failed'
    WHEN processing_status = 'processing' THEN 'queueing'
    ELSE NULL
  END,
  processing_progress = CASE
    WHEN processing_status = 'completed' THEN 100
    WHEN processing_status = 'processing' THEN 10
    ELSE NULL
  END
WHERE processing_stage IS NULL OR processing_progress IS NULL;
