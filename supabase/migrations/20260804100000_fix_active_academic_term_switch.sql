-- Switch active academic terms in separate statements. A single multi-row UPDATE can
-- set the target row to true before clearing the current row, which transiently
-- violates academic_terms_single_active_idx.
CREATE OR REPLACE FUNCTION public.set_active_academic_term(target_term_id UUID)
RETURNS public.academic_terms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_term public.academic_terms;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can set the active academic term';
  END IF;

  -- Serialize term switches so concurrent requests cannot interleave between the
  -- deactivate and activate statements.
  PERFORM pg_advisory_xact_lock(hashtext('public.set_active_academic_term'));

  IF NOT EXISTS (
    SELECT 1
    FROM public.academic_terms
    WHERE id = target_term_id
  ) THEN
    RAISE EXCEPTION 'Academic term not found';
  END IF;

  UPDATE public.academic_terms
  SET is_active = false
  WHERE is_active = true
    AND id <> target_term_id;

  UPDATE public.academic_terms
  SET is_active = true
  WHERE id = target_term_id
  RETURNING * INTO updated_term;

  RETURN updated_term;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_active_academic_term(UUID) TO authenticated;
