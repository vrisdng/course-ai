import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ActiveViewerSource } from './documentViewer';
import { PageViewer } from './PageViewer';

vi.mock('react-pdf', () => ({
  Document: ({
    children,
    onLoadSuccess,
  }: {
    children?: React.ReactNode;
    onLoadSuccess?: (meta: { numPages: number }) => void;
  }) => {
    queueMicrotask(() => onLoadSuccess?.({ numPages: 5 }));
    return <div data-testid="pdf-doc">{children}</div>;
  },
  Page: ({ pageNumber, width }: { pageNumber: number; width: number }) => (
    <div data-testid="pdf-page" data-width={width}>
      Page {pageNumber}
    </div>
  ),
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
}));

function source(overrides: Partial<ActiveViewerSource>): ActiveViewerSource {
  return {
    kind: 'pdf',
    documentName: 'Lecture Notes.pdf',
    pageNumber: 3,
    signedUrl: 'https://pdf.test/notes.pdf',
    ...overrides,
  };
}

describe('PageViewer', () => {
  it('renders the page image with no navigation or excerpt for a PDF', async () => {
    render(<PageViewer source={source()} />);
    await screen.findByTestId('pdf-page');

    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-width', '720');
    // Minimal footer: destination path plus the page number, nothing else.
    expect(screen.getByTestId('page-viewer-path')).toHaveTextContent('Lecture Notes.pdf · Page 3');
    expect(screen.queryByText(/Cited/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument();
  });

  it('shows the rendered page image with its highlight instead of loading the PDF', () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(
      <PageViewer
        source={source({
          pageImage: { url: 'https://img.test/p3.webp', width: 1400, height: 1980 },
          highlightBox: [0.1, 0.6, 0.8, 0.7],
        })}
      />,
    );

    expect(screen.queryByTestId('pdf-doc')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Lecture Notes.pdf, page 3' })).toHaveAttribute('src', 'https://img.test/p3.webp');
    expect(screen.getByTestId('citation-highlight')).toBeInTheDocument();
    // Tall pages scroll the cited passage into view instead of opening at the top.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(screen.queryByText('Loading page…')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-viewer-path')).toHaveTextContent('Lecture Notes.pdf · Page 3');
  });

  it('shows only the image for an image source', () => {
    const imageSource = source({
      kind: 'image',
      documentName: 'diagram.png',
      signedUrl: 'https://img.test/diagram.png',
      pageNumber: undefined,
    });
    render(<PageViewer source={imageSource} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://img.test/diagram.png');
    expect(img).toHaveAttribute('alt', 'diagram.png');
    expect(screen.getByTestId('page-viewer-path')).toHaveTextContent('diagram.png');
  });
});
