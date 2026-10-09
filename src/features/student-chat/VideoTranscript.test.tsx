import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), resolveSignedMediaUrl: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('./signedMedia', () => ({ resolveSignedMediaUrl: mocks.resolveSignedMediaUrl }));

import type { ActiveVideoSource } from './VideoSourceDialog';
import { VideoTranscript } from './VideoTranscript';

function query(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

const source: ActiveVideoSource = {
  title: 'Lecture', signedUrl: null, filePath: 'course/lecture.mp4', materialId: 'm1',
  startMs: 40_000, endMs: 45_000, excerpt: 'Relevant explanation.',
};
const segments = [
  { id: 'filler', start_ms: 20_000, end_ms: 30_000, text: 'Earlier context.' },
  { id: 'evidence', start_ms: 35_000, end_ms: 42_000, text: 'Relevant explanation.' },
  { id: 'context', start_ms: 42_000, end_ms: 48_000, text: 'More context.' },
];

describe('VideoTranscript sidebar preview', () => {
  beforeEach(() => {
    mocks.from.mockReset().mockImplementation(() => query(segments));
    mocks.resolveSignedMediaUrl.mockReset().mockResolvedValue('https://r2.test/lecture.mp4');
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('shows a paused citation-frame preview and opens the dialog from either control', async () => {
    const onOpenVideo = vi.fn();
    render(<VideoTranscript source={source} onOpenVideo={onOpenVideo} />);

    const frame = await screen.findByLabelText('Video thumbnail');
    expect(frame).toHaveAttribute('src', 'https://r2.test/lecture.mp4');
    expect((frame as HTMLVideoElement).muted).toBe(true);
    expect(frame).not.toHaveAttribute('controls');
    fireEvent.loadedMetadata(frame);
    expect((frame as HTMLVideoElement).currentTime).toBe(40);

    fireEvent.click(screen.getByRole('button', { name: 'Open video preview for Lecture' }));
    fireEvent.click(screen.getByRole('button', { name: 'View video with transcription' }));
    expect(onOpenVideo).toHaveBeenCalledTimes(2);
    expect(mocks.resolveSignedMediaUrl).toHaveBeenCalledWith('m1');
  });

  it('updates the preview frame when another citation in the same video is selected', async () => {
    const { rerender } = render(<VideoTranscript source={source} onOpenVideo={vi.fn()} />);
    const frame = await screen.findByLabelText('Video thumbnail') as HTMLVideoElement;
    fireEvent.loadedMetadata(frame);
    rerender(<VideoTranscript source={{ ...source, startMs: 70_000, endMs: 75_000 }} onOpenVideo={vi.fn()} />);
    expect(frame.currentTime).toBe(70);
  });

  it('shows separate timestamped segments and highlights only those overlapping the citation', async () => {
    render(<VideoTranscript source={source} onOpenVideo={vi.fn()} />);
    await screen.findByText('Relevant explanation.');
    expect(screen.getByText('0:35–0:42')).toBeInTheDocument();
    expect(screen.getByText('0:42–0:48')).toBeInTheDocument();
    expect(screen.getByText('Earlier context.').closest('[data-cited]')).toHaveAttribute('data-cited', 'false');
    expect(screen.getByText('Relevant explanation.').closest('[data-cited]')).toHaveAttribute('data-cited', 'true');
    expect(screen.getByText('More context.').closest('[data-cited]')).toHaveAttribute('data-cited', 'true');
    expect(screen.getByText('Source interval: 0:40-0:45')).toBeInTheDocument();
  });

  it('highlights only persisted evidence IDs while leaving other overlapping lines as context', async () => {
    render(<VideoTranscript source={{ ...source, startMs: 20_000, endMs: 48_000, evidenceSegments: [
      { id: 'evidence', segmentIndex: 1, startMs: 35_000, endMs: 42_000, text: 'Relevant explanation.' },
      { id: 'context', segmentIndex: 2, startMs: 42_000, endMs: 48_000, text: 'More context.' },
    ] }} onOpenVideo={vi.fn()} />);
    await screen.findByText('More context.');
    expect(screen.getByText('Relevant explanation.').closest('[data-cited]')).toHaveAttribute('data-cited', 'true');
    expect(screen.getByText('More context.').closest('[data-cited]')).toHaveAttribute('data-cited', 'true');
    expect(screen.getByText('Earlier context.').closest('[data-cited]')).toHaveAttribute('data-cited', 'false');
    expect(screen.getByText('Exact supporting segments')).toBeInTheDocument();
    const frame = await screen.findByLabelText('Video thumbnail') as HTMLVideoElement;
    fireEvent.loadedMetadata(frame);
    expect(frame.currentTime).toBe(35);
  });

  it('keeps transcript access when the original video is unavailable', async () => {
    render(<VideoTranscript source={{ ...source, filePath: null }} onOpenVideo={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'View video with transcription' })).not.toBeInTheDocument();
    expect(await screen.findByText('Relevant explanation.')).toBeInTheDocument();
  });

  it('shows a thumbnail fallback when the signed media URL cannot be resolved', async () => {
    mocks.resolveSignedMediaUrl.mockResolvedValue(null);
    await act(async () => { render(<VideoTranscript source={source} onOpenVideo={vi.fn()} />); });
    await waitFor(() => expect(mocks.resolveSignedMediaUrl).toHaveBeenCalled());
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View video with transcription' })).toBeInTheDocument();
  });
});
