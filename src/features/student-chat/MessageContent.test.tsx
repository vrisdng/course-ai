import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageContent } from './MessageContent';
import { resolveSignedMediaUrl } from './signedMedia';
import type { Citation, Message } from './types';

vi.mock('./signedMedia', () => ({
  resolveSignedMediaUrl: vi.fn(),
}));

const mockedResolve = vi.mocked(resolveSignedMediaUrl);

beforeEach(() => {
  mockedResolve.mockClear();
});

const imageCitation = (materialId: string, imageUrl: string): Citation => ({
  id: 'c1',
  chunkId: 'chunk-1',
  excerpt: 'Evidence',
  documentName: 'Notes.pdf',
  documentType: 'pdf',
  relevanceScore: 0.9,
  imageUrl,
  materialId,
});

describe('MessageContent image rendering', () => {
  it('resolves a citation image and shows it once the signed URL is available', async () => {
    mockedResolve.mockResolvedValue('https://img.test/diagram.png');
    const message: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'See ![diagram](course-materials/diagram.png) below.',
      citations: [imageCitation('mat-1', 'course-materials/diagram.png')],
    };

    render(<MessageContent message={message} onCitationClick={vi.fn()} />);

    // The trigger stays disabled until the signed URL resolves.
    await waitFor(() => expect(screen.getByRole('img', { name: 'diagram' })).toBeInTheDocument());
    const trigger = screen.getByRole('button', { name: 'diagram' });
    expect(trigger).toBeEnabled();

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await waitFor(() =>
      expect(
        screen.getAllByRole('img').some((img) => img.getAttribute('src') === 'https://img.test/diagram.png'),
      ).toBe(true),
    );
  });

  it('shows an unavailable state when the signed URL cannot be resolved', async () => {
    mockedResolve.mockResolvedValue(null);
    const message: Message = {
      id: 'a1',
      role: 'assistant',
      content: '![diagram](course-materials/broken.png)',
      citations: [imageCitation('mat-1', 'course-materials/broken.png')],
    };

    render(<MessageContent message={message} onCitationClick={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Image unavailable')).toBeInTheDocument());
  });

  it('renders a safe external image and drops unsafe urls', async () => {
    const message: Message = {
      id: 'a1',
      role: 'assistant',
      content: '![external](https://example.test/pic.png) ![bad](javascript:alert(1))',
      citations: [],
    };

    render(<MessageContent message={message} onCitationClick={vi.fn()} />);

    expect(screen.getByRole('img', { name: 'external' })).toHaveAttribute('src', 'https://example.test/pic.png');
    expect(screen.queryByRole('img', { name: 'bad' })).not.toBeInTheDocument();
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('invokes the citation callback when a citation link is clicked', async () => {
    const onCitationClick = vi.fn();
    const message: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'Claim <<cite:1>>.',
      citations: [
        {
          id: 'c1',
          chunkId: 'chunk-1',
          excerpt: 'Evidence',
          documentName: 'Notes.pdf',
          documentType: 'pdf',
          relevanceScore: 0.9,
        },
      ],
    };

    render(<MessageContent message={message} onCitationClick={onCitationClick} />);

    fireEvent.click(await screen.getByRole('button', { name: /\[1\]/ }));
    expect(onCitationClick).toHaveBeenCalledWith(message, 1);
  });
});
