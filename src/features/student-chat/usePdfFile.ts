import { useEffect, useState } from 'react';

import type { ActiveViewerSource } from './documentViewer';
import { getCachedPdf } from './pdfCache';

export interface PdfFile {
  // What react-pdf should load: an in-memory copy (blob: URL) or a link.
  file: string | null;
  status: 'loading' | 'ready' | 'error' | 'none';
}

// The PDF a viewer should display. When the source's storage location is
// known, the whole file comes from the session cache (downloaded once, never
// expires); otherwise the signed link is used directly.
export function usePdfFile(source: ActiveViewerSource): PdfFile {
  const bucket = source.storage?.bucket;
  const path = source.storage?.path;
  const [cached, setCached] = useState<PdfFile>({ file: null, status: 'loading' });

  useEffect(() => {
    if (!bucket || !path) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setCached({ file: null, status: 'loading' });
    getCachedPdf({ bucket, path })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setCached({ file: objectUrl, status: 'ready' });
      })
      .catch(() => {
        if (!cancelled) setCached({ file: null, status: 'error' });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bucket, path]);

  if (bucket && path) return cached;
  if (source.signedUrl) return { file: source.signedUrl, status: 'ready' };
  return { file: null, status: 'none' };
}
