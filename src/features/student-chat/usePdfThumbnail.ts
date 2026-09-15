// Hook to fetch a PDF page thumbnail URL from the backend.
// The thumbnail must have been pre-rendered during material ingestion.
import { useCallback, useState } from 'react';

interface ThumbnailResponse {
  signedUrl: string;
  expiresIn: number;
}

export function usePdfThumbnail() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThumbnailUrl = useCallback(
    async (materialId: string, pageNumber: number): Promise<string | null> => {
      if (!materialId || pageNumber < 1) {
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/function/v1/pdf-page-thumbnail', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('sb-ksthojmoifnunsatmday-auth-token') || ''}`,
          },
          body: JSON.stringify({ materialId, pageNumber }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to fetch thumbnail: ${response.statusText}`);
        }

        const data: ThumbnailResponse = await response.json();
        return data.signedUrl;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error fetching thumbnail';
        console.error('usePdfThumbnail error:', message);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { fetchThumbnailUrl, loading, error };
}
