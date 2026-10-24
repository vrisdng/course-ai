import { describe, expect, it, vi } from 'vitest';

import { markOnboardingTourComplete, shouldAutoStartTour } from './onboardingStatus';

describe('shouldAutoStartTour', () => {
  it('starts for a student who has never finished the tour', () => {
    expect(shouldAutoStartTour({ role: 'student', onboarding_completed_at: null })).toBe(true);
  });

  it('does not start once the tour is completed or skipped', () => {
    expect(shouldAutoStartTour({ role: 'student', onboarding_completed_at: '2026-10-24T00:00:00Z' })).toBe(false);
  });

  it('does not start for admins or before the profile loads', () => {
    expect(shouldAutoStartTour({ role: 'admin', onboarding_completed_at: null })).toBe(false);
    expect(shouldAutoStartTour(null)).toBe(false);
  });
});

describe('markOnboardingTourComplete', () => {
  it('calls the complete_onboarding_tour RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });

    await markOnboardingTourComplete({ rpc });

    expect(rpc).toHaveBeenCalledWith('complete_onboarding_tour');
  });

  it('throws when the RPC fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'nope' } });

    await expect(markOnboardingTourComplete({ rpc })).rejects.toThrow('nope');
  });
});
