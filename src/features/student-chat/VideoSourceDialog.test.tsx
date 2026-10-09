import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), resolveSignedMediaUrl: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('./signedMedia', () => ({
  resolveSignedMediaUrl: mocks.resolveSignedMediaUrl,
  invalidateSignedMediaCache: vi.fn(),
}));

import { VideoSourceDialog, type ActiveVideoSource } from './VideoSourceDialog';

function query(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'range']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve);
  return chain;
}

const source: ActiveVideoSource = {
  title: 'Lecture', signedUrl: null, filePath: 'course/lecture.mp4',
  materialId: 'm1', startMs: 40_000, endMs: 45_000,
};
const segments = [
  { id: 's1', segment_index: 0, start_ms: 20_000, end_ms: 30_000, text: 'Earlier context.' },
  { id: 's2', segment_index: 1, start_ms: 35_000, end_ms: 42_000, text: 'Relevant explanation.' },
  { id: 's3', segment_index: 2, start_ms: 42_000, end_ms: 48_000, text: 'More context.' },
];

describe('VideoSourceDialog', () => {
  beforeEach(() => {
    mocks.from.mockReset().mockImplementation(() => query(segments));
    mocks.resolveSignedMediaUrl.mockReset().mockResolvedValue('https://r2.test/lecture.mp4');
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('places a seekable video beside the full transcript and plays clicked timestamps', async () => {
    render(<VideoSourceDialog source={source} onClose={vi.fn()} />);
    const video = await screen.findByLabelText('Video playback') as HTMLVideoElement;
    expect(video).toHaveAttribute('controls');
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(40);
    await screen.findByText('Relevant explanation.');
    expect(screen.getByText('Earlier context.').closest('[data-cited]')).toHaveAttribute('data-cited', 'false');
    expect(screen.getByText('Relevant explanation.').closest('[data-cited]')).toHaveAttribute('data-cited', 'true');
    expect(screen.getByText('More context.').closest('[data-cited]')).toHaveAttribute('data-cited', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Play from 0:35' }));
    expect(video.currentTime).toBe(35);
    expect(video.play).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play from 0:35' }));
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it('fetches beyond one page of transcript segments', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      id: `s${index}`, segment_index: index, start_ms: index * 1000,
      end_ms: index * 1000 + 800, text: `Segment ${index}`,
    }));
    const firstQuery = query(firstPage);
    const secondQuery = query([{ id: 's500', segment_index: 500, start_ms: 500_000, end_ms: 500_800, text: 'Final segment' }]);
    mocks.from.mockReturnValueOnce(firstQuery).mockReturnValueOnce(secondQuery);
    render(<VideoSourceDialog source={source} onClose={vi.fn()} />);
    await screen.findByText('Final segment');
    expect(firstQuery.range).toHaveBeenCalledWith(0, 499);
    expect(secondQuery.range).toHaveBeenCalledWith(500, 999);
  });

  it('keeps a transcript-only fallback for old videos without stored media', async () => {
    render(<VideoSourceDialog source={{ ...source, filePath: null, linkedUrl: 'https://video.test/watch?v=1' }} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Video playback')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to original video/ })).toHaveAttribute('href', 'https://video.test/watch?v=1&t=40');
    expect(await screen.findByText('Relevant explanation.')).toBeInTheDocument();
  });

  it('reports transcript loading failures separately from an empty transcript', async () => {
    mocks.from.mockReturnValueOnce(query(null, { message: 'offline' }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<VideoSourceDialog source={source} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load transcript.'));
    consoleError.mockRestore();
  });
});
