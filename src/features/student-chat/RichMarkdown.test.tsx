import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RichMarkdown } from './RichMarkdown';
import { resolveSignedMediaUrl } from './signedMedia';
import type { Citation } from './types';

vi.mock('./signedMedia', () => ({
  resolveSignedMediaUrl: vi.fn(),
}));

const mockedResolve = vi.mocked(resolveSignedMediaUrl);

beforeEach(() => {
  mockedResolve.mockResolvedValue('https://img.test/diagram.png');
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

describe('RichMarkdown code rendering', () => {
  it('renders a highlighted block with a language label and copy button', () => {
    const content = '```python\nx = 1\n```\n\nInline `let y = 2;` code.';
    const { container } = render(<RichMarkdown content={content} />);

    expect(screen.getByText('python')).toBeInTheDocument();
    const copyButton = screen.getByRole('button', { name: 'Copy code' });
    expect(copyButton).toBeInTheDocument();

    const codeEl = screen.getByText('let y = 2;').closest('code');
    expect(codeEl?.className).toContain('font-mono');

    const highlighted = container.querySelector('.hljs');
    expect(highlighted).not.toBeNull();
  });

  it('copies the code to the clipboard when the copy button is pressed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const content = "Here's a snippet:\n\n```js\nconst a = 1;\n```\n\nIt assigns a value.";
    render(<RichMarkdown content={content} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1;'));
  });
});

describe('RichMarkdown math rendering', () => {
  it('renders inline LaTeX via katex', () => {
    const { container } = render(<RichMarkdown content="Energy equals mass times c squared, $E=mc^2$, done." />);
    expect(container.textContent).toContain('Energy equals mass times c squared,');
    expect(container.textContent).toContain('done.');
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders block LaTeX via katex', () => {
    const { container } = render(<RichMarkdown content="Integral:\n\n$$\\int_0^1 x\\,dx$$\n\nafter." />);
    expect(container.textContent).toContain('after.');
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders block LaTeX delimited by backslash brackets', () => {
    const content = 'Value:\n\n\\[\\text{Total} = a + b\\]\n\nafter.';
    const { container } = render(<RichMarkdown content={content} />);
    expect(container.textContent).toContain('after.');
    expect(container.textContent).not.toContain('\\[');
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders inline LaTeX delimited by backslash parens', () => {
    const content = 'Area is \\(\\pi r^2\\) here.';
    const { container } = render(<RichMarkdown content={content} />);
    expect(container.textContent).toContain('here.');
    expect(container.textContent).not.toContain('\\(');
    expect(container.querySelector('.katex')).not.toBeNull();
  });
});

describe('RichMarkdown tables and images', () => {
  it('renders a markdown table with headers and rows', () => {
    const content = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const { container } = render(<RichMarkdown content={content} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(container.querySelector('th')).toHaveTextContent('a');
    expect(container.querySelector('td')).toHaveTextContent('1');
  });

  it('resolves and displays a cited image, opening the lightbox on click', async () => {
    const message = '![diagram](course-materials/diagram.png) here';
    render(<RichMarkdown content={message} citations={[imageCitation('mat-1', 'course-materials/diagram.png')]} />);

    await waitFor(() => expect(screen.getByRole('img', { name: 'diagram' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'diagram' }));
    await waitFor(() =>
      expect(
        screen.getAllByRole('img').some((img) => img.getAttribute('src') === 'https://img.test/diagram.png'),
      ).toBe(true),
    );
  });

  it('drops unsafe image URLs and renders safe external ones', () => {
    const content = '![bad](javascript:alert(1)) ![ok](https://example.test/p.png)';
    const { container } = render(<RichMarkdown content={content} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('src', 'https://example.test/p.png');
  });
});

describe('RichMarkdown citations', () => {
  it('calls the citation callback when a citation link is clicked', () => {
    const onCitationClick = vi.fn();
    render(
      <RichMarkdown
        content="Claim <<cite:1>>."
        citations={[
          {
            id: 'c1',
            chunkId: 'chunk-1',
            excerpt: 'Evidence',
            documentName: 'Notes.pdf',
            documentType: 'pdf',
            relevanceScore: 0.9,
          },
        ]}
        onCitationClick={onCitationClick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /\[1\]/ }));
    expect(onCitationClick).toHaveBeenCalledWith(1);
  });
});
