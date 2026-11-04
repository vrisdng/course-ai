-- A cancellation must win the state transition before it can leave cleanup work.
-- Otherwise a concurrent completion can mark the material uploaded while the
-- cleanup reaper still holds an instruction to delete its object.
CREATE FUNCTION public.cancel_video_upload_with_cleanup(p_material_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  material_row public.materials;
  multipart_upload_id text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO material_row
  FROM public.materials
  WHERE id = p_material_id AND file_type = 'video'
  FOR UPDATE;

  IF NOT FOUND OR material_row.video_upload_state NOT IN ('uploading', 'cancelled') THEN
    RETURN false;
  END IF;

  SELECT r2_upload_id INTO multipart_upload_id
  FROM public.materials_multipart_uploads
  WHERE material_id = material_row.id AND state = 'in_progress';

  INSERT INTO public.video_storage_cleanup (
    file_path, storage_provider, object_key, r2_multipart_upload_id, next_cleanup_at, last_error
  ) VALUES (
    material_row.file_path,
    material_row.storage_provider,
    CASE WHEN material_row.storage_provider = 'r2' THEN material_row.file_path ELSE NULL END,
    multipart_upload_id,
    now(),
    NULL
  ) ON CONFLICT (file_path) DO UPDATE SET
    storage_provider = EXCLUDED.storage_provider,
    object_key = EXCLUDED.object_key,
    r2_multipart_upload_id = COALESCE(EXCLUDED.r2_multipart_upload_id, video_storage_cleanup.r2_multipart_upload_id),
    next_cleanup_at = EXCLUDED.next_cleanup_at,
    last_error = NULL;

  UPDATE public.materials
  SET video_upload_state = 'cancelled', processing_stage = 'cancelled', processing_error = NULL
  WHERE id = material_row.id AND video_upload_state = 'uploading';

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_video_upload_with_cleanup(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_video_upload_with_cleanup(uuid) TO service_role;

-- Old versions could leave a cleanup row after a completion won the race.
-- Claiming cleanup locks the material and either protects the unfinished object
-- from a later completion or discards that stale instruction for an uploaded one.
CREATE FUNCTION public.claim_video_storage_cleanup(p_file_path text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  material_row public.materials;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO material_row
  FROM public.materials
  WHERE file_path = p_file_path AND file_type = 'video'
  FOR UPDATE;

  IF FOUND AND material_row.video_upload_state = 'uploaded' THEN
    DELETE FROM public.video_storage_cleanup WHERE file_path = p_file_path;
    RETURN false;
  END IF;

  IF FOUND AND material_row.video_upload_state = 'uploading' THEN
    UPDATE public.materials
    SET video_upload_state = 'cancelled', processing_stage = 'cancelled', processing_error = NULL
    WHERE id = material_row.id AND video_upload_state = 'uploading';
  END IF;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_video_storage_cleanup(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_storage_cleanup(text) TO service_role;
