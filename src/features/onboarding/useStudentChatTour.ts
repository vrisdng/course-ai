import { useCallback, useEffect, useRef } from 'react';

import { useAuth } from '@/contexts/AuthContext';

import { markOnboardingTourComplete, shouldAutoStartTour } from './onboardingStatus';
import { useRegisterTour } from './TourContext';
import { STUDENT_CHAT_TOUR } from './tourSteps';
import { useProductTour } from './useProductTour';

export interface UseStudentChatTourOptions {
  /** True once the elements the tour points at have rendered (e.g. courses loaded). */
  isReady: boolean;
  prepare?: () => void;
}

/**
 * The chat page tour: starts by itself on a student's first visit, and the header's
 * help button replays it for anyone. Finishing or skipping both count as done.
 */
export function useStudentChatTour({ isReady, prepare }: UseStudentChatTourOptions): void {
  const { profile, refreshProfile } = useAuth();
  const hasAutoStarted = useRef(false);
  const isFirstRun = shouldAutoStartTour(profile);

  const handleFinish = useCallback(() => {
    if (!isFirstRun) return;
    markOnboardingTourComplete()
      .then(refreshProfile)
      .catch((error: unknown) => console.error('Could not save onboarding tour status:', error));
  }, [isFirstRun, refreshProfile]);

  const { start } = useProductTour({ steps: STUDENT_CHAT_TOUR, prepare, onFinish: handleFinish });
  const startTour = useCallback(() => void start(), [start]);

  useRegisterTour(startTour);

  useEffect(() => {
    if (!isReady || !isFirstRun || hasAutoStarted.current) return;
    hasAutoStarted.current = true;
    startTour();
  }, [isReady, isFirstRun, startTour]);
}
