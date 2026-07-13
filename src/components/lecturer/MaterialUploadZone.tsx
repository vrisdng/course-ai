import React, { useCallback, useRef } from 'react';
import { Upload, FileText, Image, FileSpreadsheet, Video } from 'lucide-react';
import {
  INLINE_GEMINI_MAX_FILE_SIZE_BYTES,
} from '@/lib/materialUpload';

interface MaterialUploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  acceptedExtensions: string;
  isDisabled?: boolean;
}

const FILE_ICONS: Record<string, React.ReactNode> = {
  pdf: <FileText className="h-5 w-5 text-destructive" />,
  png: <Image className="h-5 w-5 text-info" />,
  jpg: <Image className="h-5 w-5 text-info" />,
  jpeg: <Image className="h-5 w-5 text-info" />,
  webp: <Image className="h-5 w-5 text-info" />,
  gif: <Image className="h-5 w-5 text-info" />,
  doc: <FileText className="h-5 w-5 text-primary" />,
  docx: <FileText className="h-5 w-5 text-primary" />,
  pptx: <FileSpreadsheet className="h-5 w-5 text-warning" />,
  mp4: <Video className="h-5 w-5 text-primary" />,
  webm: <Video className="h-5 w-5 text-primary" />,
};

export function MaterialUploadZone({
  onFilesSelected,
  acceptedExtensions,
  isDisabled = false,
}: MaterialUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (isDisabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFilesSelected(files);
    },
    [onFilesSelected, isDisabled]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!isDisabled) setIsDragging(true);
    },
    [isDisabled]
  );

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) onFilesSelected(files);
      // Reset input so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = '';
    },
    [onFilesSelected]
  );

  const documentLimitMb = Math.round(INLINE_GEMINI_MAX_FILE_SIZE_BYTES / 1024 / 1024);

  return (
    <div
      className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
        isDragging
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50'
      } ${isDisabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptedExtensions}
        className="hidden"
        onChange={handleFileInput}
      />

      <Upload className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
      <p className="mb-1 text-sm font-medium text-foreground">
        Drag & drop files here, or click to browse
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {Object.entries(FILE_ICONS).map(([ext, icon]) => (
          <span
            key={ext}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            {icon}
            .{ext}
          </span>
        ))}
      </div>

      <div className="mx-auto mt-5 max-w-xl rounded-lg border border-border/70 bg-background/80 p-4 text-left">
        <p className="text-sm font-medium text-foreground">What can be uploaded?</p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li>PDF, DOC, DOCX, PPTX, PNG, JPG, JPEG, WEBP, and GIF files.</li>
          <li>PDF, DOC, and image files must be {documentLimitMb}MB or smaller.</li>
          <li>MP4 and WebM video files are supported (audio is extracted and transcribed with timestamps).</li>
          <li>DOCX and PPTX files are extracted after upload.</li>
        </ul>
      </div>
    </div>
  );
}
