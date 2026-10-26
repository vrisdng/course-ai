import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useCallback, useEffect, useRef } from 'react';

import './tour.css';
import { resolveTourSteps, type TourStepDefinition } from './tourSteps';

export interface UseProductTourOptions {
  steps: TourStepDefinition[];
  /** Runs before the steps are resolved, e.g. to open a collapsed sidebar. */
  prepare?: () => void;
  /** Runs once when the tour closes, whether it was finished or skipped. */
  onFinish?: () => void;
}

export interface ProductTour {
  start: () => Promise<void>;
}

/** Waits for React to commit and the browser to lay out what `prepare` changed. */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function useProductTour({ steps, prepare, onFinish }: UseProductTourOptions): ProductTour {
  const driverRef = useRef<Driver | null>(null);
  const latest = useRef({ steps, prepare, onFinish });
  latest.current = { steps, prepare, onFinish };

  useEffect(() => () => driverRef.current?.destroy(), []);

  const start = useCallback(async () => {
    driverRef.current?.destroy();
    latest.current.prepare?.();
    await waitForPaint();

    const resolved = resolveTourSteps(latest.current.steps);
    if (resolved.length === 0) return;

    let finished = false;
    const tour = driver({
      steps: resolved,
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      closeBtnLabel: 'Skip tour',
      popoverClass: 'ceechat-tour',
      stagePadding: 6,
      stageRadius: 8,
      onDestroyed: () => {
        if (finished) return;
        finished = true;
        if (driverRef.current === tour) driverRef.current = null;
        latest.current.onFinish?.();
      },
    });
    driverRef.current = tour;
    tour.drive();
  }, []);

  return { start };
}
