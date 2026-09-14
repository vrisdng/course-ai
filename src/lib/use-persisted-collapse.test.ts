import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { usePersistedCollapse } from './use-persisted-collapse';

type Handle = ReturnType<typeof usePersistedCollapse>;

describe('usePersistedCollapse', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('defaults to collapsed when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedCollapse('key:default'));
    expect(result.current[0]).toBe(true);
  });

  it('honours an explicit non-default initial value', () => {
    const { result } = renderHook(() => usePersistedCollapse('key:open', false));
    expect(result.current[0]).toBe(false);
  });

  it('reads a previously persisted value', () => {
    localStorage.setItem('key:read', 'true');
    const { result } = renderHook(() => usePersistedCollapse('key:read'));
    expect(result.current[0]).toBe(true);
  });

  it('persists the collapsed state on change and toggles it', () => {
    const { result } = renderHook(() => usePersistedCollapse('key:toggle'));
    expect(result.current[0]).toBe(true);

    act(() => {
      (result.current as Handle)[2]();
    });
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem('key:toggle')).toBe('false');

    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('key:toggle')).toBe('true');
  });
});
