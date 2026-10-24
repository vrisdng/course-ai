import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  markCitationStep: vi.fn(),
  markCitationTranscriptPainted: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('./citationPerf', () => ({
  markCitationStep: mocks.markCitationStep,
  markCitationTranscriptPainted: mocks.markCitationTranscriptPainted,
}));

import type { ActiveVideoSource } from './VideoSourceDialog';
import { VideoTranscript } from './VideoTranscript';

function query(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  return chain;
}

function pendingQuery() {
  let resolveQuery: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => { resolveQuery = resolve; });
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => pending.then(resolve);
  return {
    chain,
    resolve: (data: unknown) => resolveQuery({ data, error: null }),
  };
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
    mocks.markCitationStep.mockReset();
    mocks.markCitationTranscriptPainted.mockReset();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('shows a static play placeholder and opens the dialog from either control', async () => {
    const onOpenVideo = vi.fn();
    const { container } = render(<VideoTranscript source={source} onOpenVideo={onOpenVideo} />);

    expect(container.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open video preview for Lecture' }));
    fireEvent.click(screen.getByRole('button', { name: 'View video with transcription' }));
    expect(onOpenVideo).toHaveBeenCalledTimes(2);
    expect(mocks.markCitationStep).toHaveBeenCalledWith('placeholder_visible');
    await screen.findByText('Relevant explanation.');
  });

  it('renders persisted evidence before the transcript window returns', async () => {
    const pending = pendingQuery();
    mocks.from.mockImplementation(() => pending.chain);
    render(<VideoTranscript source={{ ...source, evidenceSegments: [
      { id: 'evidence', segmentIndex: 1, startMs: 35_000, endMs: 42_000, text: 'Relevant explanation.' },
      { id: 'context', segmentIndex: 2, startMs: 42_000, endMs: 48_000, text: 'More context.' },
    ] }} onOpenVideo={vi.fn()} />);

    expect(screen.getByText('Relevant explanation.')).toBeInTheDocument();
    expect(screen.getByText('More context.')).toBeInTheDocument();
    expect(screen.queryByText('Loading transcript...')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.markCitationTranscriptPainted).toHaveBeenCalledWith('evidence'));

    pending.resolve(segments);
    await screen.findByText('Earlier context.');
    expect(screen.getByText('Relevant explanation.')).toBeInTheDocument();
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
    expect(screen.getByText('Source interval: 0:35-0:48')).toBeInTheDocument();
    expect(screen.getByText('Relevant explanation.').closest('[data-cited]')).toHaveAttribute('data-cited', 'true');
    expect(screen.getByText('More context.').closest('[data-cited]')).toHaveAttribute('data-cited', 'true');
    expect(screen.getByText('Earlier context.').closest('[data-cited]')).toHaveAttribute('data-cited', 'false');
    expect(screen.getByText('Exact supporting segments')).toBeInTheDocument();
  });

  it('keeps transcript access when the original video is unavailable', async () => {
    render(<VideoTranscript source={{ ...source, filePath: null }} onOpenVideo={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'View video with transcription' })).not.toBeInTheDocument();
    expect(await screen.findByText('Relevant explanation.')).toBeInTheDocument();
  });
});
