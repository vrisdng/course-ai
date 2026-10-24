import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import { DEFAULT_CHAT_SETTINGS } from './chatSettingsForm';
import { useCourseChatSettings } from './useCourseChatSettings';

function chain(result: { data?: unknown; error: unknown }) {
  const value: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'upsert']) value[method] = vi.fn(() => value);
  value.maybeSingle = vi.fn(() => Promise.resolve(result));
  value.single = vi.fn(() => Promise.resolve(result));
  return value;
}

describe('useCourseChatSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing without a course', () => {
    const { result } = renderHook(() => useCourseChatSettings(null, 'admin-1'));
    expect(result.current.settings).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("loads the course's settings", async () => {
    const db = chain({ data: { final_count: 6, default_model_tier: 'smart' }, error: null });
    mocks.from.mockReturnValue(db);
    const { result } = renderHook(() => useCourseChatSettings('course-1', 'admin-1'));
    await waitFor(() => expect(result.current.settings).not.toBeNull());
    expect(mocks.from).toHaveBeenCalledWith('course_chat_settings');
    expect(db.eq).toHaveBeenCalledWith('course_id', 'course-1');
    expect(result.current.settings).toMatchObject({ finalCount: 6, defaultModelTier: 'smart' });
  });

  it('uses the defaults when the course has no row yet', async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    const { result } = renderHook(() => useCourseChatSettings('course-1', 'admin-1'));
    await waitFor(() => expect(result.current.settings).toEqual(DEFAULT_CHAT_SETTINGS));
  });

  it('reports a load failure', async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: { message: 'denied' } }));
    const { result } = renderHook(() => useCourseChatSettings('course-1', 'admin-1'));
    await waitFor(() => expect(result.current.loadError).toBe('denied'));
    expect(result.current.settings).toBeNull();
  });

  it('upserts the settings with the editor and keeps what the database returns', async () => {
    mocks.from.mockReturnValueOnce(chain({ data: null, error: null }));
    const { result } = renderHook(() => useCourseChatSettings('course-1', 'admin-1'));
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    const saveDb = chain({ data: { final_count: 4 }, error: null });
    mocks.from.mockReturnValueOnce(saveDb);
    let saved = false;
    await act(async () => {
      saved = await result.current.save({ ...DEFAULT_CHAT_SETTINGS, finalCount: 4 });
    });

    expect(saved).toBe(true);
    expect(saveDb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ course_id: 'course-1', final_count: 4, updated_by: 'admin-1' }),
      { onConflict: 'course_id' },
    );
    expect(result.current.settings?.finalCount).toBe(4);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Chat settings saved');
  });

  it('round-trips the video share through the settings row', async () => {
    mocks.from.mockReturnValueOnce(chain({ data: { video_share_percent: 20 }, error: null }));
    const { result } = renderHook(() => useCourseChatSettings('course-1', 'admin-1'));
    await waitFor(() => expect(result.current.settings?.videoSharePercent).toBe(20));

    const saveDb = chain({ data: { video_share_percent: 70 }, error: null });
    mocks.from.mockReturnValueOnce(saveDb);
    await act(async () => {
      await result.current.save({ ...DEFAULT_CHAT_SETTINGS, videoSharePercent: 70 });
    });
    expect(saveDb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ course_id: 'course-1', video_share_percent: 70 }),
      { onConflict: 'course_id' },
    );
    expect(result.current.settings?.videoSharePercent).toBe(70);
  });

  it('keeps the stored share when the database refuses the change (e.g. a non-admin blocked by RLS)', async () => {
    mocks.from.mockReturnValueOnce(chain({ data: { video_share_percent: 20 }, error: null }));
    const { result } = renderHook(() => useCourseChatSettings('course-1', 'student-1'));
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    mocks.from.mockReturnValueOnce(chain({ data: null, error: { message: 'new row violates row-level security policy' } }));
    let saved = true;
    await act(async () => {
      saved = await result.current.save({ ...DEFAULT_CHAT_SETTINGS, videoSharePercent: 90 });
    });
    expect(saved).toBe(false);
    expect(result.current.settings?.videoSharePercent).toBe(20);
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save chat settings: new row violates row-level security policy');
  });

  it('reports a save failure and keeps the previous settings', async () => {
    mocks.from.mockReturnValueOnce(chain({ data: { final_count: 6 }, error: null }));
    const { result } = renderHook(() => useCourseChatSettings('course-1', 'admin-1'));
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    mocks.from.mockReturnValueOnce(chain({ data: null, error: { message: 'violates check constraint' } }));
    let saved = true;
    await act(async () => {
      saved = await result.current.save({ ...DEFAULT_CHAT_SETTINGS, finalCount: 4 });
    });

    expect(saved).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save chat settings: violates check constraint');
    expect(result.current.settings?.finalCount).toBe(6);
    expect(result.current.isSaving).toBe(false);
  });
});
