import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn();
let capturedOnFinish: (() => void) | undefined;
vi.mock('./useProductTour', () => ({
  useProductTour: (options: { onFinish?: () => void }) => {
    capturedOnFinish = options.onFinish;
    return { start };
  },
}));

const markOnboardingTourComplete = vi.fn();
vi.mock('./onboardingStatus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./onboardingStatus')>()),
  markOnboardingTourComplete: () => markOnboardingTourComplete(),
}));

const refreshProfile = vi.fn();
let profile: { role: 'student' | 'admin'; onboarding_completed_at: string | null } | null;
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile, refreshProfile }),
}));

import { TourHelpButton, TourProvider } from './TourContext';
import { useStudentChatTour } from './useStudentChatTour';
import { render, screen, fireEvent } from '@testing-library/react';

const wrapper = ({ children }: { children: ReactNode }) => <TourProvider>{children}</TourProvider>;

describe('useStudentChatTour', () => {
  beforeEach(() => {
    start.mockClear();
    refreshProfile.mockClear();
    markOnboardingTourComplete.mockReset().mockResolvedValue(undefined);
    capturedOnFinish = undefined;
    profile = { role: 'student', onboarding_completed_at: null };
  });

  it('auto-starts once for a first-time student when the page is ready', () => {
    const { rerender } = renderHook(({ isReady }) => useStudentChatTour({ isReady }), {
      wrapper,
      initialProps: { isReady: false },
    });
    expect(start).not.toHaveBeenCalled();

    rerender({ isReady: true });
    rerender({ isReady: true });

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not auto-start for students who already finished it, or for admins', () => {
    profile = { role: 'student', onboarding_completed_at: '2026-10-24T00:00:00Z' };
    renderHook(() => useStudentChatTour({ isReady: true }), { wrapper });

    profile = { role: 'admin', onboarding_completed_at: null };
    renderHook(() => useStudentChatTour({ isReady: true }), { wrapper });

    expect(start).not.toHaveBeenCalled();
  });

  it('saves completion and refreshes the profile when a first-time tour ends', async () => {
    renderHook(() => useStudentChatTour({ isReady: true }), { wrapper });

    act(() => capturedOnFinish?.());

    await waitFor(() => expect(refreshProfile).toHaveBeenCalledTimes(1));
    expect(markOnboardingTourComplete).toHaveBeenCalledTimes(1);
  });

  it('does not save again when a finished student replays the tour', () => {
    profile = { role: 'student', onboarding_completed_at: '2026-10-24T00:00:00Z' };
    renderHook(() => useStudentChatTour({ isReady: true }), { wrapper });

    act(() => capturedOnFinish?.());

    expect(markOnboardingTourComplete).not.toHaveBeenCalled();
  });

  it('keeps going quietly if saving fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    markOnboardingTourComplete.mockRejectedValue(new Error('offline'));
    renderHook(() => useStudentChatTour({ isReady: true }), { wrapper });

    act(() => capturedOnFinish?.());

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(refreshProfile).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('lets anyone replay the tour from the help button', () => {
    profile = { role: 'admin', onboarding_completed_at: null };
    function Page() {
      useStudentChatTour({ isReady: true });
      return <TourHelpButton />;
    }

    render(<Page />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Show tour' }));

    expect(start).toHaveBeenCalledTimes(1);
  });
});
