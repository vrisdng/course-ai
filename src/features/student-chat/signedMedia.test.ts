import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

import { invalidateSignedMediaCache, resolveSignedMediaUrl } from './signedMedia';

const OK_JSON = (extra: Record<string, unknown> = {}) =>
  ({ ok: true, json: async () => ({ signedUrl: 'https://cdn.test/x.png', expiresIn: 600, ...extra }) }) as Response;

beforeEach(() => {
  mocks.getSession.mockReset();
  mocks.toastError.mockReset();
  invalidateSignedMediaCache();
});

describe('resolveSignedMediaUrl', () => {
  it('posts the material id and returns the signed URL', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(OK_JSON());
    vi.stubGlobal('fetch', fetchMock);

    const url = await resolveSignedMediaUrl('mat-1');

    expect(url).toBe('https://cdn.test/x.png');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [urlArg, options] = fetchMock.mock.calls[0];
    expect(urlArg).toContain('/functions/v1/signed-media');
    expect(options).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1' }),
    });
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('caches the resolved URL and reuses it before expiry', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(OK_JSON());
    vi.stubGlobal('fetch', fetchMock);

    await resolveSignedMediaUrl('mat-1');
    await resolveSignedMediaUrl('mat-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes once the cached entry has expired', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(OK_JSON());
    vi.stubGlobal('fetch', fetchMock);

    await resolveSignedMediaUrl('mat-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 60 * 1000);
    await resolveSignedMediaUrl('mat-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    Date.now.mockRestore();
  });

  it('returns null and surfaces a toast when the request fails', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));

    const url = await resolveSignedMediaUrl('mat-1');

    expect(url).toBeNull();
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it('returns null without fetching when there is no session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(OK_JSON());
    vi.stubGlobal('fetch', fetchMock);

    expect(await resolveSignedMediaUrl('mat-1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the material id is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(OK_JSON());
    vi.stubGlobal('fetch', fetchMock);

    expect(await resolveSignedMediaUrl(null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
