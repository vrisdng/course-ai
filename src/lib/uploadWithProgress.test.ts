import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession } } }));

type Listener = (event: ProgressEvent) => void;
class FakeXhr {
  static current: FakeXhr;
  status = 0;
  responseText = '';
  headers: Record<string, string> = {};
  listeners: Record<string, Listener> = {};
  upload = { addEventListener: vi.fn((name: string, listener: Listener) => { this.uploadListener = listener; }) };
  uploadListener?: Listener;
  open = vi.fn();
  setRequestHeader = vi.fn((name: string, value: string) => { this.headers[name] = value; });
  addEventListener = vi.fn((name: string, listener: Listener) => { this.listeners[name] = listener; });
  send = vi.fn(() => { FakeXhr.current = this; });
  abort = vi.fn(() => this.listeners.abort?.({} as ProgressEvent));
}

describe('uploadToStorageWithProgress', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeXhr.current = undefined!;
    getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } });
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });

  async function start(options: Record<string, unknown> = {}) {
    const { uploadToStorageWithProgress } = await import('./uploadWithProgress');
    return uploadToStorageWithProgress({ bucket: 'materials', path: 'course/file.txt', body: new Blob(['hi']), ...options });
  }

  it('rejects before starting a request when unauthenticated', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } });
    await expect(start()).rejects.toThrow('Not authenticated');
  });

  it('sends authenticated uploads, reports byte progress, and resolves on success', async () => {
    const onProgress = vi.fn();
    const promise = start({ contentType: 'text/plain', onProgress });
    await vi.waitFor(() => expect(FakeXhr.current).toBeDefined());
    const xhr = FakeXhr.current;
    expect(xhr.open).toHaveBeenCalledWith('POST', expect.stringContaining('/storage/v1/object/materials/course/file.txt'));
    expect(xhr.headers).toMatchObject({ Authorization: 'Bearer token', apikey: expect.any(String), 'Content-Type': 'text/plain', 'x-upsert': 'false' });
    xhr.uploadListener?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    xhr.status = 201; xhr.listeners.load({} as ProgressEvent);
    await expect(promise).resolves.toBeUndefined();
  });

  it('uses server errors and falls back for malformed responses and network failures', async () => {
    let promise = start(); await vi.waitFor(() => expect(FakeXhr.current).toBeDefined());
    FakeXhr.current.status = 400; FakeXhr.current.responseText = '{"message":"Too large"}'; FakeXhr.current.listeners.load({} as ProgressEvent);
    await expect(promise).rejects.toThrow('Too large');

    let previous = FakeXhr.current;
    promise = start(); await vi.waitFor(() => expect(FakeXhr.current).not.toBe(previous));
    FakeXhr.current.status = 503; FakeXhr.current.responseText = 'oops'; FakeXhr.current.listeners.load({} as ProgressEvent);
    await expect(promise).rejects.toThrow('Upload failed (503)');

    previous = FakeXhr.current;
    promise = start(); await vi.waitFor(() => expect(FakeXhr.current).not.toBe(previous));
    FakeXhr.current.listeners.error({} as ProgressEvent);
    await expect(promise).rejects.toThrow('Network error');
  });

  it('handles signals aborted before and during upload', async () => {
    const alreadyAborted = new AbortController(); alreadyAborted.abort();
    await expect(start({ signal: alreadyAborted.signal })).rejects.toThrow('Upload cancelled');

    const controller = new AbortController();
    const promise = start({ signal: controller.signal });
    await vi.waitFor(() => expect(FakeXhr.current).toBeDefined());
    controller.abort();
    expect(FakeXhr.current.abort).toHaveBeenCalled();
    await expect(promise).rejects.toThrow('Upload cancelled');
  });
});
