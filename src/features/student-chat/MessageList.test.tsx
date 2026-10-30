import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageList } from './MessageList';
import type { Citation, Message } from './types';

const citation = (type: string, name: string): Citation => ({
  id: name, chunkId: `chunk-${name}`, excerpt: 'Evidence', documentName: name,
  documentType: type, relevanceScore: 0.9,
});
describe('MessageList', () => {
  it('renders suggestions and sends the selected prompt from the empty state', () => {
    const onSuggestionClick = vi.fn();
    render(<MessageList messages={[]} onSuggestionClick={onSuggestionClick} onOpenSources={vi.fn()} onCitationClick={vi.fn()} />);
    expect(screen.getByText('Welcome to CEEGPT')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'What are the key takeaways?' }));
    expect(onSuggestionClick).toHaveBeenCalledWith('What are the key takeaways?');
  });
  it('can suppress the empty state and shows thinking for an empty assistant response', () => {
    const callbacks = { onSuggestionClick: vi.fn(), onOpenSources: vi.fn(), onCitationClick: vi.fn() };
    const { container, rerender } = render(<MessageList messages={[]} showEmptyState={false} {...callbacks} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MessageList messages={[{ id: 'a1', role: 'assistant', content: '' }]} {...callbacks} />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });
  it('shows what is being searched in place of thinking', () => {
    const callbacks = { onSuggestionClick: vi.fn(), onOpenSources: vi.fn(), onCitationClick: vi.fn() };
    render(<MessageList messages={[{ id: 'a1', role: 'assistant', content: '', status: 'Searching course materials for "tombstones"' }]} {...callbacks} />);
    expect(screen.getByText('Searching course materials for "tombstones"')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });
  it('renders markdown, safe external links, source counts, and clickable citations', () => {
    const onCitationClick = vi.fn(); const onOpenSources = vi.fn();
    const message: Message = { id: 'a1', role: 'assistant', content: '## Answer\nSee <<cite:1>> and [reference](https://example.test).', citations: [citation('pdf', 'Notes.pdf')] };
    render(<MessageList messages={[message]} onSuggestionClick={vi.fn()} onOpenSources={onOpenSources} onCitationClick={onCitationClick} />);
    expect(screen.getByRole('heading', { name: 'Answer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'reference' })).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('button', { name: /\[1\]/ }));
    expect(onCitationClick).toHaveBeenCalledWith(message, 1);
  });
  it.each(['<<cite:1>> <<cite:2>>', '<<cite:1+2>>'])(
    'renders separate clickable source families for %s', (markers) => {
      const onCitationClick = vi.fn();
      const message: Message = { id: 'a1', role: 'assistant', content: `Claim ${markers}`, citations: [citation('video', 'Lecture'), citation('pdf', 'Notes')] };
      render(<MessageList messages={[message]} onSuggestionClick={vi.fn()} onOpenSources={vi.fn()} onCitationClick={onCitationClick} />);
      const webcast = screen.getByRole('button', { name: /\[1\].*Webcast/ });
      const notes = screen.getByRole('button', { name: /\[2\].*Notes/ });
      expect(webcast).toHaveAttribute('title', 'Lecture');
      expect(notes).toHaveAttribute('title', 'Notes');
      fireEvent.click(webcast);
      fireEvent.click(notes);
      expect(onCitationClick).toHaveBeenNthCalledWith(1, message, 1);
      expect(onCitationClick).toHaveBeenNthCalledWith(2, message, 2);
    },
  );
});
