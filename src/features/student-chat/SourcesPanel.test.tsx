import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Citation, Message } from './types';
import { SourcesPanel } from './SourcesPanel';

const video: Citation = { id: 'v1', chunkId: 'c1', excerpt: 'video evidence', documentName: 'Lecture', documentType: 'video', startMs: 65_000, endMs: 70_000, relevanceScore: 0.876 };
const pdf: Citation = { id: 'p1', chunkId: 'c2', excerpt: 'page evidence', documentName: 'Notes', documentType: 'pdf', pageNumber: 4, relevanceScore: 0.7 };
const message: Message = { id: 'm1', role: 'assistant', content: 'answer', citations: [video, pdf] };
const props = () => ({ showSidePanel: true, selectedMessage: message, highlightedCitationKey: null, openingCitationKey: null, onOpenPanel: vi.fn(), onClosePanel: vi.fn(), onClearHighlight: vi.fn(), onOpenCitationSource: vi.fn() });

describe('SourcesPanel', () => {
  beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
  it('opens and closes the panel and provides an empty-state instruction', () => {
    const value = props(); const { rerender } = render(<SourcesPanel {...value} selectedMessage={null} />);
    expect(screen.getByText(/Click on a message with sources/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[0]); expect(value.onClosePanel).toHaveBeenCalled();
    rerender(<SourcesPanel {...value} showSidePanel={false} />);
    fireEvent.click(screen.getByRole('button')); expect(value.onOpenPanel).toHaveBeenCalled();
  });
  it('shows source metadata and opens video and document citations', () => {
    const value = props(); render(<SourcesPanel {...value} />);
    expect(screen.getByText('88% match')).toBeInTheDocument(); expect(screen.getByText('70% match')).toBeInTheDocument();
    expect(screen.getByText('1:05 – 1:10')).toBeInTheDocument(); expect(screen.getByText('Page 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to 1:05' }));
    fireEvent.click(screen.getByRole('button', { name: 'View original file' }));
    expect(value.onOpenCitationSource).toHaveBeenNthCalledWith(1, video, 'm1-1');
    expect(value.onOpenCitationSource).toHaveBeenNthCalledWith(2, pdf, 'm1-2');
  });
  it('disables an opening source and clears a highlighted source after the timeout', () => {
    vi.useFakeTimers(); const value = props();
    render(<SourcesPanel {...value} highlightedCitationKey="m1-1" openingCitationKey="m1-1" />);
    expect(screen.getByRole('button', { name: 'Opening source...' })).toBeDisabled();
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    vi.advanceTimersByTime(1_800); expect(value.onClearHighlight).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
