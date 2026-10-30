-- material_processing_jobs is internal worker state. Only edge functions using the
-- service role read or write it, so browsers (anon/authenticated) get no access.
-- RLS with no policies denies everything except the service role, which bypasses RLS.
ALTER TABLE public.material_processing_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.material_processing_jobs FROM anon, authenticated;

-- These SECURITY DEFINER functions bypass RLS, so they must not be callable from
-- the browser either. process-material-job and reap-stale-jobs call them as service_role.
REVOKE EXECUTE ON FUNCTION public.claim_material_processing_job(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reap_stale_material_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_material_processing_job(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_stale_material_jobs() TO service_role;
