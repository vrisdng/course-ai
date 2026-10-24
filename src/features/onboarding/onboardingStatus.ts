import { supabase } from '@/integrations/supabase/client';

export interface OnboardingProfile {
  role: 'student' | 'admin';
  onboarding_completed_at: string | null;
}

interface RpcClient {
  rpc: (fn: 'complete_onboarding_tour') => PromiseLike<{ error: { message: string } | null }>;
}

/** The first-visit tour is for students who have neither finished nor skipped it. */
export function shouldAutoStartTour(profile: OnboardingProfile | null): boolean {
  return profile?.role === 'student' && profile.onboarding_completed_at === null;
}

/** Records that the signed-in user finished or skipped the tour. Safe to call twice. */
export async function markOnboardingTourComplete(client: RpcClient = supabase): Promise<void> {
  const { error } = await client.rpc('complete_onboarding_tour');
  if (error) throw new Error(error.message);
}
