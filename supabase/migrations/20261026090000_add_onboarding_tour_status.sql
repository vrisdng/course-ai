-- Remembers when a user finished or skipped the onboarding tour, so it only
-- starts by itself on their first visit. NULL means they have not seen it yet.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- Marks the tour done for the signed-in user only. Keeps the first timestamp on replays.
CREATE OR REPLACE FUNCTION public.complete_onboarding_tour()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles
  SET onboarding_completed_at = COALESCE(onboarding_completed_at, now())
  WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding_tour() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding_tour() TO authenticated;
