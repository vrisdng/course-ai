import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ActiveViewerSource } from './documentViewer';
import { DocumentViewerDialog } from './DocumentViewerDialog';

vi.mock('./PdfViewer', () => ({ PdfViewer: ({ documentName }: { documentName: string }) => <div data-testid="pdf-viewer">{documentName}</div> }));
vi.mock('./ImageViewer', () => ({ ImageViewer: ({ documentName }: { documentName: string }) => <div data-testid="image-viewer">{documentName}</div> }));
vi.mock('./OtherViewer', () => ({ OtherViewer: ({ documentName }: { documentName: string }) => <div data-testid="other-viewer">{documentName}</div> }));

const source = (overrides: Partial<ActiveViewerSource>): ActiveViewerSource => ({
  kind: 'pdf',
  documentName: 'Notes.pdf',
  pageNumber: 1,
  signedUrl: 'https://pdf.test/n.pdf',
  materialId: 'm1',
  excerpt: 'excerpt',
  ...overrides,
});

describe('DocumentViewer', () => {
  it('renders nothing when there is no source', () => {
    const { container } = render(<DocumentViewerDialog source={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('dispatches pdf, image, and other sources to the matching viewer', () => {
    render(<DocumentViewerDialog source={source({ kind: 'pdf' })} onClose={vi.fn()} />);
    expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();

    render(<DocumentViewerDialog source={source({ kind: 'image', documentName: 'diagram.png' })} onClose={vi.fn()} />);
    expect(screen.getByTestId('image-viewer')).toBeInTheDocument();

    render(<DocumentViewerDialog source={source({ kind: 'other', documentName: 'slide.pptx' })} onClose={vi.fn()} />);
    expect(screen.getByTestId('other-viewer')).toBeInTheDocument();
  });

  it('labels each kind in the header', () => {
    render(<DocumentViewerDialog source={source({ kind: 'pdf' })} onClose={vi.fn()} />);
    expect(screen.getByText('PDF')).toBeInTheDocument();
    render(<DocumentViewerDialog source={source({ kind: 'image' })} onClose={vi.fn()} />);
    expect(screen.getByText('Image')).toBeInTheDocument();
    render(<DocumentViewerDialog source={source({ kind: 'other', documentName: 'archive.zip' })} onClose={vi.fn()} />);
    expect(screen.getByText('ZIP')).toBeInTheDocument();
  });

  it('closes through the dialog control', () => {
    const onClose = vi.fn();
    render(<DocumentViewerDialog source={source({})} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps a padded header fixed above a scrollable viewer', () => {
    render(<DocumentViewerDialog source={source({})} onClose={vi.fn()} />);
    expect(document.querySelector('[class*="p-3"]')).toBeInTheDocument();
    expect(document.querySelector('[class*="overflow-auto"]')).toBeInTheDocument();
  });
});
