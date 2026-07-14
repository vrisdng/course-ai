import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
import { VideoSourceDialog, type ActiveVideoSource } from './VideoSourceDialog';

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
const transcriptSource: ActiveVideoSource = { title: 'Lecture', signedUrl: null, materialId: 'm1', startMs: 40_000, endMs: 45_000, linkedUrl: 'https://video.test/watch?v=1' };

describe('VideoSourceDialog', () => {
  beforeEach(() => {
    mocks.from.mockReset(); mocks.from.mockImplementation(() => query({ data: [], error: null }));
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  it('plays signed videos, seeks to the citation, and offers the original URL', async () => {
    const source: ActiveVideoSource = { title: 'Stored lecture', signedUrl: 'https://storage.test/video.mp4', materialId: 'm1', startMs: 12_000, endMs: 20_000 };
    render(<VideoSourceDialog source={source} onClose={vi.fn()} />);
    expect(screen.getByText('Cited segment: 0:12-0:20')).toBeInTheDocument();
    const video = document.querySelector('video')!;
    await waitFor(() => expect(video.getAttribute('src')).toBe(source.signedUrl));
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(12);
    expect(screen.getByRole('link', { name: /Open video/ })).toHaveAttribute('href', source.signedUrl);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('loads a bounded transcript window, highlights the citation, and timestamps external links', async () => {
    const segments = [
      { id: 's1', segment_index: 1, start_ms: 35_000, end_ms: 42_000, text: 'Relevant explanation.' },
      { id: 's2', segment_index: 2, start_ms: 42_000, end_ms: 48_000, text: 'More context.' },
    ];
    const chain = query({ data: segments, error: null }); mocks.from.mockReturnValue(chain);
    render(<VideoSourceDialog source={transcriptSource} onClose={vi.fn()} />);
    expect(screen.getByText('Loading transcript...')).toBeInTheDocument();
    await screen.findByText('Relevant explanation. More context.');
    expect(chain.eq).toHaveBeenCalledWith('material_id', 'm1');
    expect(chain.gte).toHaveBeenCalledWith('start_ms', 10_000);
    expect(chain.lte).toHaveBeenCalledWith('start_ms', 75_000);
    expect(screen.getByRole('link', { name: /Go to original video/ })).toHaveAttribute('href', 'https://video.test/watch?v=1&t=40');
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
  });
  it('shows transcript and original-video fallbacks when content is unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.from.mockReturnValueOnce(query({ data: null, error: { message: 'offline' } }));
    render(<VideoSourceDialog source={{ ...transcriptSource, linkedUrl: null }} onClose={vi.fn()} />);
    expect(screen.getByText(/original video is not stored online/)).toBeInTheDocument();
    expect(await screen.findByText('No transcript segments available.')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled(); consoleError.mockRestore();
  });
  it('preserves malformed external URLs and closes through the dialog control', async () => {
    const onClose = vi.fn();
    render(<VideoSourceDialog source={{ ...transcriptSource, linkedUrl: 'not a valid url' }} onClose={onClose} />);
    expect(screen.getByRole('link', { name: /Go to original video/ })).toHaveAttribute('href', 'not a valid url');
    await screen.findByText('No transcript segments available.');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
