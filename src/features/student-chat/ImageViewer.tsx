import { type ActiveViewerSource } from './documentViewer';

interface ImageViewerProps {
  source: ActiveViewerSource;
  onClose: () => void;
}

export function ImageViewer({ source, onClose }: ImageViewerProps) {
  return (
    <div className="flex h-full min-h-full items-center justify-center bg-black/40 p-6">
      {source.signedUrl ? (
        <img
          src={source.signedUrl}
          alt={source.documentName}
          className="max-h-[75vh] w-auto rounded-lg object-contain shadow-lg"
        />
      ) : (
        <div className="py-16 text-sm text-muted-foreground">Image unavailable.</div>
      )}
    </div>
  );
}
