import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from 'driver.js';

const drive = vi.fn();
const destroy = vi.fn();
let lastConfig: Config | undefined;

vi.mock('driver.js', () => ({
  driver: (config: Config) => {
    lastConfig = config;
    return { drive, destroy };
  },
}));

import { useProductTour } from './useProductTour';

const WELCOME = [{ id: 'welcome', title: 'Welcome', description: 'Hello' }];

function finishTour() {
  // driver.js calls onDestroyed after Done, Skip (close), Esc or an overlay click.
  lastConfig?.onDestroyed?.(undefined, {}, {} as never);
}

describe('useProductTour', () => {
  beforeEach(() => {
    drive.mockClear();
    destroy.mockClear();
    lastConfig = undefined;
  });

  it('prepares the page, then drives the resolved steps', async () => {
    const prepare = vi.fn();
    const { result } = renderHook(() => useProductTour({ steps: WELCOME, prepare }));

    await act(() => result.current.start());

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(lastConfig?.steps).toEqual([{ popover: { title: 'Welcome', description: 'Hello' } }]);
    expect(lastConfig?.showProgress).toBe(true);
    expect(drive).toHaveBeenCalledTimes(1);
  });

  it('reports the tour as finished exactly once', async () => {
    const onFinish = vi.fn();
    const { result } = renderHook(() => useProductTour({ steps: WELCOME, onFinish }));

    await act(() => result.current.start());
    finishTour();
    finishTour();

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no steps are on screen', async () => {
    const onFinish = vi.fn();
    const { result } = renderHook(() =>
      useProductTour({ steps: [{ id: 'x', title: 'X', description: 'd', targets: ['missing'] }], onFinish }),
    );

    await act(() => result.current.start());

    expect(drive).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('destroys a running tour on unmount', async () => {
    const { result, unmount } = renderHook(() => useProductTour({ steps: WELCOME }));

    await act(() => result.current.start());
    unmount();

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
