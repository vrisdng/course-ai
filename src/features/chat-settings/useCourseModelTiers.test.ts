import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));

import { useCourseModelTiers } from './useCourseModelTiers';

function chain(result: { data?: unknown; error: unknown }) {
  const value: Record<string, unknown> = {};
  for (const method of ['select', 'eq']) value[method] = vi.fn(() => value);
  value.maybeSingle = vi.fn(() => Promise.resolve(result));
  return value;
}

describe('useCourseModelTiers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers every tier with fast as the default before a course is chosen', () => {
    const { result } = renderHook(() => useCourseModelTiers(null));
    expect(result.current).toEqual({ allowedTiers: ['fast', 'smart', 'pro'], defaultTier: 'fast', isLoaded: false });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reads the course's allowed and default tiers", async () => {
    const db = chain({ data: { allowed_model_tiers: ['smart', 'pro'], default_model_tier: 'pro' }, error: null });
    mocks.from.mockReturnValue(db);
    const { result } = renderHook(() => useCourseModelTiers('course-1'));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(db.select).toHaveBeenCalledWith('allowed_model_tiers, default_model_tier');
    expect(result.current).toMatchObject({ allowedTiers: ['smart', 'pro'], defaultTier: 'pro' });
  });

  it('falls back to every tier when the settings cannot be read', async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: { message: 'denied' } }));
    const { result } = renderHook(() => useCourseModelTiers('course-1'));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current).toMatchObject({ allowedTiers: ['fast', 'smart', 'pro'], defaultTier: 'fast' });
  });
});
