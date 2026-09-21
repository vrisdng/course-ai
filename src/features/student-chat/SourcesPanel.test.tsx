import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ActiveViewerSource } from './documentViewer';
import { SourcesPanel } from './SourcesPanel';

const viewport = vi.hoisted(() => ({ isMobile: false }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => viewport.isMobile }));

vi.mock('./PdfReader', () => ({
  PdfReader: ({ source }: { source: ActiveViewerSource }) => (
    <div data-testid="pdf-reader">{source.documentName}</div>
  ),
}));

vi.mock('./PdfThumbnail', () => ({
  PdfThumbnail: ({ pageNumber, onClick }: { pageNumber: number; onClick?: () => void }) => (
    <button type="button" data-testid="pdf-thumb" data-page={pageNumber} onClick={onClick}>
      Thumb {pageNumber}
    </button>
  ),
}));

vi.mock('./PageViewer', () => ({
  PageViewer: ({ source }: { source: ActiveViewerSource }) => (
    <div data-testid="page-viewer">{source.documentName}</div>
  ),
}));

vi.mock('./useTranscriptWindow', () => ({
  useTranscriptWindow: () => ({
    segments: [
      { start_ms: 35_000, end_ms: 42_000, text: 'Relevant explanation.' },
      { start_ms: 42_000, end_ms: 48_000, text: 'More context.' },
    ],
    isLoading: false,
  }),
}));

function source(overrides: Partial<ActiveViewerSource>): ActiveViewerSource {
  return {
    kind: 'pdf',
    documentName: 'Lecture Notes',
    pageNumber: 1,
    signedUrl: 'https://pdf.test/notes.pdf',
    ...overrides,
  };
}

const props = (overrides: Partial<Parameters<typeof SourcesPanel>[0]> = {}) => ({
  showSidePanel: true,
  activeViewerSource: null,
  onOpenPanel: vi.fn(),
  onClosePanel: vi.fn(),
  ...overrides,
});

describe('SourcesPanel', () => {
  it('closes through the panel control', () => {
    const value = props();
    render(<SourcesPanel {...value} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close sources' }));
    expect(value.onClosePanel).toHaveBeenCalled();
  });

  it('opens through the toggle when collapsed', () => {
    const value = props({ showSidePanel: false });
    render(<SourcesPanel {...value} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open sources' }));
    expect(value.onOpenPanel).toHaveBeenCalled();
  });

  it('opens the document reader from the View document button', () => {
    const value = props({ showSidePanel: true, activeViewerSource: source() });
    render(<SourcesPanel {...value} />);
    expect(screen.queryByTestId('pdf-reader')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View document' }));
    expect(screen.getByTestId('pdf-reader')).toBeInTheDocument();
    expect(screen.getByTestId('pdf-reader')).toHaveTextContent('Lecture Notes');
  });

  it('shows a preview thumbnail of the cited page above the excerpt', () => {
    const value = props({ showSidePanel: true, activeViewerSource: source({ pageNumber: 2 }) });
    render(<SourcesPanel {...value} />);
    expect(screen.getByTestId('pdf-thumb')).toHaveAttribute('data-page', '2');
  });

  it('opens the single-page viewer when the preview thumbnail is tapped', () => {
    const value = props({ showSidePanel: true, activeViewerSource: source({ pageNumber: 2 }) });
    render(<SourcesPanel {...value} />);
    expect(screen.queryByTestId('page-viewer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pdf-thumb'));
    expect(screen.getByTestId('page-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('page-viewer')).toHaveTextContent('Lecture Notes');
  });

  it('shows the destination path for an active source', () => {
    const value = props({ showSidePanel: true, activeViewerSource: source() });
    render(<SourcesPanel {...value} />);
    expect(screen.getByText('Lecture Notes - 1')).toBeInTheDocument();
  });

  it('shows the cited excerpt when present', () => {
    const value = props({ showSidePanel: true, activeViewerSource: source({ excerpt: 'the cited text' }) });
    render(<SourcesPanel {...value} />);
    expect(screen.getByText('“the cited text”')).toBeInTheDocument();
  });

  it('hides the View document button when no source is active', () => {
    const value = props({ showSidePanel: true, activeViewerSource: null });
    render(<SourcesPanel {...value} />);
    expect(screen.queryByRole('button', { name: 'View document' })).not.toBeInTheDocument();
  });

  it('shows the empty state when no source is active', () => {
    const value = props({ activeViewerSource: null });
    render(<SourcesPanel {...value} />);
    expect(screen.getByText('Select a citation to see the source')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-gallery')).not.toBeInTheDocument();
  });

  it('resizes the panel when the handle is dragged', () => {
    const value = props({ showSidePanel: true });
    const { container } = render(<SourcesPanel {...value} />);
    const handle = container.querySelector('[role="slider"]');
    expect(handle).toBeInTheDocument();

    fireEvent.mouseDown(handle, { clientX: 400 });
    expect((container.querySelector('aside') as HTMLElement).style.width).toBe('460px');

    fireEvent.mouseMove(window, { clientX: 430 });
    expect((container.querySelector('aside') as HTMLElement).style.width).toBe('430px');

    fireEvent.mouseMove(window, { clientX: 300 });
    expect((container.querySelector('aside') as HTMLElement).style.width).toBe('560px');

    fireEvent.mouseMove(window, { clientX: 10 });
    expect((container.querySelector('aside') as HTMLElement).style.width).toBe('760px');

    fireEvent.mouseUp(window);
  });

  it('shows the cited transcript with timestamps for a video source', () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const value = props({
      showSidePanel: true,
      activeViewerSource: null,
      activeVideoSource: { title: 'Lecture', signedUrl: null, materialId: 'm1', startMs: 40_000, endMs: 45_000 },
    });
    render(<SourcesPanel {...value} />);
    expect(screen.getByText('Cited segment: 0:40-0:45')).toBeInTheDocument();
    expect(screen.getByText('Lecture')).toBeInTheDocument();
    expect(screen.getByText('Relevant explanation. More context.')).toBeInTheDocument();
    expect(screen.getByText('0:35–0:48')).toBeInTheDocument();
  });

  it('opens the stored video when a signed video source is active', () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const value = props({
      showSidePanel: true,
      activeViewerSource: null,
      activeVideoSource: { title: 'Lecture', signedUrl: 'https://storage.test/video.mp4', materialId: 'm1', startMs: 40_000, endMs: 45_000 },
    });
    render(<SourcesPanel {...value} />);
    expect(screen.getByRole('link', { name: 'Open video' })).toHaveAttribute('href', 'https://storage.test/video.mp4');
  });

  it('hides the transcript for a video source when the panel is collapsed', () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const value = props({
      showSidePanel: false,
      activeViewerSource: null,
      activeVideoSource: { title: 'Lecture', signedUrl: null, materialId: 'm1', startMs: 40_000, endMs: 45_000 },
    });
    render(<SourcesPanel {...value} />);
    expect(screen.queryByText('Relevant explanation. More context.')).not.toBeInTheDocument();
  });

  it('shares the row with a draggable width on desktop', () => {
    viewport.isMobile = false;
    render(<SourcesPanel {...props()} />);
    const aside = screen.getByRole('complementary');
    expect(aside).toHaveStyle({ width: '460px' });
    expect(aside.className).toContain('relative');
    expect(screen.getByRole('slider', { name: 'Resize sources panel' })).toBeInTheDocument();
  });

  it('covers the chat as a full-width overlay on phones without a resize handle', () => {
    viewport.isMobile = true;
    render(<SourcesPanel {...props()} />);
    const aside = screen.getByRole('complementary');
    expect(aside.style.width).toBe('');
    expect(aside.className).toContain('fixed');
    expect(aside.className).toContain('w-full');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close sources' })).toBeInTheDocument();
    viewport.isMobile = false;
  });

  it('collapses to zero width on phones when closed so the chat keeps the full row', () => {
    viewport.isMobile = true;
    render(<SourcesPanel {...props({ showSidePanel: false })} />);
    const aside = screen.getByRole('complementary');
    expect(aside).toHaveStyle({ width: '0px' });
    expect(aside.className).not.toContain('fixed');
    viewport.isMobile = false;
  });
});
