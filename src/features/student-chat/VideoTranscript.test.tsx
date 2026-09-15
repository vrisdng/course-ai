import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
import type { ActiveVideoSource } from './VideoSourceDialog';
import { VideoTranscript } from './VideoTranscript';

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const transcriptSource: ActiveVideoSource = {
  title: 'Lecture',
  signedUrl: null,
  materialId: 'm1',
  startMs: 40_000,
  endMs: 45_000,
};

const segments = [
  { start_ms: 35_000, end_ms: 42_000, text: 'Relevant explanation.' },
  { start_ms: 42_000, end_ms: 48_000, text: 'More context.' },
];

describe('VideoTranscript', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.from.mockImplementation(() => query({ data: [], error: null }));
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('shows the cited segment locator and scrolls the overlapping paragraph into view', async () => {
    const chain = query({ data: segments, error: null });
    mocks.from.mockReturnValue(chain);
    await act(async () => {
      render(<VideoTranscript source={transcriptSource} />);
    });
    expect(screen.getByText('Cited segment: 0:40-0:45')).toBeInTheDocument();
    expect(screen.getByText('Lecture')).toBeInTheDocument();
    await screen.findByText('Relevant explanation. More context.');
    expect(chain.eq).toHaveBeenCalledWith('material_id', 'm1');
    await waitFor(() => expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('renders timestamped labels for each transcript paragraph', async () => {
    mocks.from.mockReturnValue(query({ data: segments, error: null }));
    await act(async () => {
      render(<VideoTranscript source={transcriptSource} />);
    });
    await screen.findByText('Relevant explanation. More context.');
    expect(screen.getByText('0:35–0:48')).toBeInTheDocument();
  });

  it('offers an Open video link only when the file is stored', async () => {
    await act(async () => {
      render(<VideoTranscript source={{ ...transcriptSource, signedUrl: 'https://storage.test/video.mp4' }} />);
    });
    expect(screen.getByRole('link', { name: 'Open video' })).toHaveAttribute('href', 'https://storage.test/video.mp4');
  });

  it('omits the Open video link when the file is not stored', async () => {
    await act(async () => {
      render(<VideoTranscript source={transcriptSource} />);
    });
    expect(screen.queryByRole('link', { name: 'Open video' })).not.toBeInTheDocument();
  });

  it('shows the empty state when no transcript segments exist', async () => {
    await act(async () => {
      render(<VideoTranscript source={transcriptSource} />);
    });
    await screen.findByText('No transcript segments available.');
  });

  it('opens the stored video in a new tab', async () => {
    await act(async () => {
      render(<VideoTranscript source={{ ...transcriptSource, signedUrl: 'https://storage.test/video.mp4' }} />);
    });
    fireEvent.click(screen.getByRole('link', { name: 'Open video' }));
  });
});
