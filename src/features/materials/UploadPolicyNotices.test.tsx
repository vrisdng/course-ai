import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AcceptedUploadsHelp, AcceptedUploadsHint, RejectedUploadsAlert } from './UploadPolicyNotices';

describe('AcceptedUploadsHint', () => {
  it('names the accepted formats under the drop zone prompt', () => {
    render(<AcceptedUploadsHint />);
    expect(screen.getByText('PDF documents and MP4 or WebM videos only')).toBeInTheDocument();
  });
});

describe('AcceptedUploadsHelp', () => {
  it('lists only what the upload policy accepts and how to convert other files', () => {
    render(<AcceptedUploadsHelp documentLimitMb={15} />);
    expect(screen.getByText('What can be uploaded?')).toBeInTheDocument();
    expect(screen.getByText('PDF documents and MP4 or WebM videos.')).toBeInTheDocument();
    expect(screen.getByText('PDF files must be 15MB or smaller.')).toBeInTheDocument();
    expect(screen.getByText(/Save or export Word \(DOCX\) and PowerPoint \(PPTX\) files as PDF/)).toBeInTheDocument();
    expect(screen.queryByText(/DOCX and PPTX files are extracted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PNG|JPG|GIF/)).not.toBeInTheDocument();
  });

  it('drops the conversion hint when Office uploads are switched back on', () => {
    render(<AcceptedUploadsHelp documentLimitMb={15} policy={{ enabledFamilies: ['pdf', 'video', 'office'] }} />);
    expect(
      screen.getByText('PDF documents, Word or PowerPoint files (DOCX, PPTX) and MP4 or WebM videos.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Save or export/)).not.toBeInTheDocument();
  });
});

describe('RejectedUploadsAlert', () => {
  it('renders nothing when no file was turned away', () => {
    const { container } = render(<RejectedUploadsAlert rejections={[]} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces each rejected file with its reason and can be dismissed', () => {
    const onDismiss = vi.fn();
    render(
      <RejectedUploadsAlert
        rejections={[
          { fileName: 'slides.pptx', message: '"slides.pptx" can\'t be uploaded. Only PDF documents and MP4 or WebM videos are accepted.' },
          { fileName: 'photo.png', message: '"photo.png" can\'t be uploaded. Only PDF documents and MP4 or WebM videos are accepted.' },
        ]}
        onDismiss={onDismiss}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('2 files were not added');
    expect(alert).toHaveTextContent('"slides.pptx" can\'t be uploaded.');
    expect(alert).toHaveTextContent('"photo.png" can\'t be uploaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('uses singular wording for one file', () => {
    render(<RejectedUploadsAlert rejections={[{ fileName: 'a.docx', message: 'nope' }]} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('1 file was not added');
  });
});
