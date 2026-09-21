import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOBILE_BREAKPOINT, useIsMobile } from './use-mobile';

type Listener = () => void;

function mockViewport(width: number) {
  const listeners = new Set<Listener>();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: width < MOBILE_BREAKPOINT,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
    dispatchEvent: vi.fn(),
  }));
  return {
    resize(nextWidth: number) {
      window.innerWidth = nextWidth;
      listeners.forEach((listener) => listener());
    },
  };
}

describe('useIsMobile', () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('reports a phone-width viewport as mobile', () => {
    mockViewport(390);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('reports a desktop viewport as not mobile and tracks resizes', () => {
    const viewport = mockViewport(1280);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => viewport.resize(500));
    expect(result.current).toBe(true);
  });
});
