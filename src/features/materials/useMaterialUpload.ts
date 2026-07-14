import { createClient } from '@supabase/supabase-js';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import {
  getDeferredUploadValidationError,
  getImmediateUploadValidationError,
  isTextLikeUpload,
  isVideoUpload,
} from '@/lib/materialUpload';
import { uploadToStorageWithProgress } from '@/lib/uploadWithProgress';
import { uploadVideoForTranscription } from '@/lib/videoUploadPipeline';
import type { AccessScope, UploadOutcome } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const SUPPORTED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'gif',
  'txt', 'md', 'markdown', 'csv', 'json', 'ts', 'tsx', 'js', 'jsx',
  'py', 'java', 'go', 'rb', 'rs', 'c', 'cpp', 'html', 'css', 'sql',
  'mp4', 'webm',
]);

export const ACCEPTED_FILE_TYPES =
  '.txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.java,.go,.rb,.rs,.c,.cpp,.html,.css,.sql,.pdf,.doc,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm';

function getFileType(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (['vtt', 'srt'].includes(ext)) return 'transcript';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides';
  if (['doc', 'docx'].includes(ext)) return 'notes';
  if (['mp4', 'webm'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'other';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rb', 'rs', 'c', 'cpp', 'sql'].includes(ext)) return 'code';
  if (['md', 'markdown', 'txt', 'csv', 'json'].includes(ext)) return 'notes';
  return 'other';
}

function isFileSupported(candidate: File) {
  const extension = candidate.name.split('.').pop()?.toLowerCase() || '';
  return candidate.type.startsWith('text/') || SUPPORTED_EXTENSIONS.has(extension);
}

function getPendingFileKey(candidate: File) {
  return `${candidate.name}-${candidate.size}-${candidate.lastModified}`;
}

interface UseMaterialUploadOptions {
  uploaderId: string | undefined;
  onUploaded: () => Promise<void> | void;
}

export function useMaterialUpload({ uploaderId, onUploaded }: UseMaterialUploadOptions) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [currentUploadFileName, setCurrentUploadFileName] = useState<string | null>(null);
  const [currentUploadStatusText, setCurrentUploadStatusText] = useState<string | null>(null);
  const [currentUploadProgress, setCurrentUploadProgress] = useState<number | null>(null);
  const [currentUploadFileSize, setCurrentUploadFileSize] = useState<number | null>(null);
  const [currentUploadIndex, setCurrentUploadIndex] = useState<{ current: number; total: number } | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cancelUploadRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Only .insert()/.functions.invoke() calls below need mid-flight abort;
  // PostgREST's query builder has no abortSignal() method, so the abort has
  // to be injected at the fetch layer via a second client. Session storage
  // is left at defaults (no persist) since this client never needs to survive
  // a reload — every request rides on the already-authenticated main client.
  const supabaseAbortable = useMemo(
    () =>
      createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false },
        global: {
          fetch: (input: RequestInfo | URL, init: RequestInit = {}) => {
            const controller = abortControllerRef.current;
            if (controller && !init.signal) {
              init = { ...init, signal: controller.signal };
            }
            return fetch(input, init);
          },
        },
      }),
    []
  );

  const resetUploadSelection = () => {
    setPendingFiles([]);
    setCurrentUploadFileName(null);
    setCurrentUploadStatusText(null);
    setCurrentUploadProgress(null);
    setCurrentUploadFileSize(null);
    setCurrentUploadIndex(null);
    setIsDragActive(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const addPendingFiles = (candidates: File[], uploadSetupError: string | null) => {
    if (!candidates.length) {
      return;
    }

    if (uploadSetupError) {
      toast.error(uploadSetupError);
      return;
    }

    const unsupported: string[] = [];
    const oversized: string[] = [];
    const knownKeys = new Set(pendingFiles.map((item) => getPendingFileKey(item)));
    const accepted: File[] = [];

    for (const candidate of candidates) {
      if (!isFileSupported(candidate)) {
        unsupported.push(candidate.name);
        continue;
      }

      const sizeValidationError = getImmediateUploadValidationError(candidate);
      if (sizeValidationError) {
        oversized.push(candidate.name);
        continue;
      }

      const key = getPendingFileKey(candidate);
      if (knownKeys.has(key)) {
        continue;
      }

      knownKeys.add(key);
      accepted.push(candidate);
    }

    if (accepted.length > 0) {
      setPendingFiles((previous) => {
        const previousKeys = new Set(previous.map((item) => getPendingFileKey(item)));
        return [...previous, ...accepted.filter((candidate) => !previousKeys.has(getPendingFileKey(candidate)))];
      });
    }

    if (unsupported.length > 0) {
      toast.error(`Skipped ${unsupported.length} unsupported file${unsupported.length === 1 ? '' : 's'}.`);
    }

    if (oversized.length > 0) {
      toast.error(
        `Skipped ${oversized.length} file${oversized.length === 1 ? '' : 's'} that exceed the upload limits for document or video processing.`
      );
    }

    if (accepted.length === 0 && unsupported.length === 0 && oversized.length === 0) {
      toast.info('These files are already in your review list.');
    }
  };

  const removePendingFile = (fileKey: string) => {
    if (isUploading) {
      return;
    }
    setPendingFiles((previous) => previous.filter((candidate) => getPendingFileKey(candidate) !== fileKey));
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>, uploadSetupError: string | null) => {
    addPendingFiles(Array.from(event.target.files || []), uploadSetupError);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOpenFilePicker = (uploadSetupError: string | null) => {
    if (uploadSetupError && !isUploading) {
      toast.error(uploadSetupError);
      return;
    }

    if (!isUploading && !uploadSetupError) {
      fileInputRef.current?.click();
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>, uploadSetupError: string | null) => {
    event.preventDefault();
    if (!isUploading && !uploadSetupError) {
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>, uploadSetupError: string | null) => {
    event.preventDefault();
    setIsDragActive(false);

    if (isUploading) {
      return;
    }

    if (uploadSetupError) {
      toast.error(uploadSetupError);
      return;
    }

    addPendingFiles(Array.from(event.dataTransfer.files || []), uploadSetupError);
  };

  const handleCancelUpload = () => {
    if (isUploading) {
      cancelUploadRef.current = true;
      abortControllerRef.current?.abort();
      return;
    }

    resetUploadSelection();
  };

  const uploadSingleFile = async (
    targetFile: File,
    courseId: string,
    accessScope: AccessScope,
    academicTermId: string,
    uploadController: AbortController
  ): Promise<UploadOutcome> => {
    const extension = targetFile.name.split('.').pop()?.toLowerCase() || '';
    const isSupported = targetFile.type.startsWith('text/') || SUPPORTED_EXTENSIONS.has(extension);
    if (!isSupported) {
      throw new Error('Unsupported file type. Please upload a supported format.');
    }

    const uploadValidationError = await getDeferredUploadValidationError(targetFile);
    if (uploadValidationError) {
      throw new Error(uploadValidationError);
    }

    // Video files use client-side audio extraction — handle separately
    if (isVideoUpload(targetFile)) {
      if (cancelUploadRef.current || uploadController.signal.aborted) {
        throw new Error('Upload cancelled');
      }

      await uploadVideoForTranscription({
        file: targetFile,
        courseId,
        academicTermId,
        accessScope,
        uploaderId: uploaderId!,
        onProgress: (update) => {
          setCurrentUploadStatusText(update.statusText);
          setCurrentUploadProgress(update.progress);
        },
        signal: uploadController.signal,
      });
      return 'processing';
    }

    setCurrentUploadStatusText(`Uploading ${targetFile.name}... 0%`);
    setCurrentUploadProgress(0);

    const filePath = `${courseId}/${crypto.randomUUID()}-${targetFile.name}`;
    console.log('[admin-upload]', `Uploading "${targetFile.name}" (${(targetFile.size / 1024 / 1024).toFixed(1)} MB) to ${filePath}`);
    const uploadStart = performance.now();

    await uploadToStorageWithProgress({
      bucket: 'course-materials',
      path: filePath,
      body: targetFile,
      signal: uploadController.signal,
      onProgress: (fraction) => {
        const pct = Math.round(fraction * 100);
        setCurrentUploadStatusText(`Uploading ${targetFile.name}... ${pct}%`);
        setCurrentUploadProgress(pct * 0.5); // upload is 0-50%, processing is 50-100%
      },
    });

    console.log('[admin-upload]', `Upload complete in ${((performance.now() - uploadStart) / 1000).toFixed(1)}s`);

    if (cancelUploadRef.current || uploadController.signal.aborted) {
      throw new Error('Upload cancelled');
    }

    const { data: material, error: insertError } = await supabaseAbortable
      .from('materials')
      .insert({
        course_id: courseId,
        file_name: targetFile.name,
        file_path: filePath,
        file_type: getFileType(targetFile.name),
        file_size: targetFile.size,
        topic: null,
        week_number: null,
        processing_status: 'processing',
        access_scope: accessScope,
        is_public: accessScope === 'public',
        academic_term_id: academicTermId,
        uploaded_by: uploaderId,
      })
      .select('id')
      .single();

    setCurrentUploadStatusText('Processing...');
    setCurrentUploadProgress(50);

    if (insertError || !material) {
      if (insertError?.message?.toLowerCase().includes('access_scope')) {
        throw new Error('Database is missing access scope support. Run the latest migrations.');
      }
      throw new Error(insertError?.message || 'Failed to create material record');
    }

    if (cancelUploadRef.current || uploadController.signal.aborted) {
      throw new Error('Upload cancelled');
    }

    const isTextLike = isTextLikeUpload(targetFile);
    if (isTextLike) {
      const text = await targetFile.text();
      const { data: ingestResult, error: ingestError } = await supabaseAbortable.functions.invoke('ingest-material', {
        body: {
          materialId: material.id,
          text,
        },
        signal: uploadController.signal,
      });

      if (ingestError) {
        throw new Error(ingestError.message || 'Failed to ingest material');
      }

      if (ingestResult?.error) {
        throw new Error(ingestResult.error);
      }
      return 'indexed';
    }

    const { data: parseResult, error: parseError } = await supabaseAbortable.functions.invoke('parse-document', {
      body: {
        materialId: material.id,
        filePath,
        fileType: extension,
      },
      signal: uploadController.signal,
    });

    if (parseError) {
      throw new Error(parseError.message || 'Failed to parse material');
    }

    if (parseResult?.error) {
      throw new Error(parseResult.error);
    }

    return parseResult?.queued ? 'processing' : 'indexed';
  };

  const handleUpload = async (uploadCourseId: string, uploadAccessScope: AccessScope | '', uploadAcademicTermId: string) => {
    if (!uploaderId) {
      toast.error('Profile not loaded');
      return;
    }
    if (!uploadCourseId) {
      toast.error('Select a course first');
      return;
    }
    if (!uploadAccessScope) {
      toast.error('Choose who can access this document');
      return;
    }
    if (!uploadAcademicTermId) {
      toast.error('Choose the academic term for this upload');
      return;
    }
    if (pendingFiles.length === 0) {
      toast.error('Choose at least one file to upload');
      return;
    }

    const queue = [...pendingFiles];
    const failedFiles: File[] = [];
    let indexedCount = 0;
    let processingCount = 0;
    let index = 0;

    setIsUploading(true);
    cancelUploadRef.current = false;

    try {
      for (index = 0; index < queue.length; index += 1) {
        if (cancelUploadRef.current) {
          break;
        }

        const targetFile = queue[index];
        setCurrentUploadFileName(targetFile.name);
        setCurrentUploadStatusText(null);
        setCurrentUploadProgress(null);
        setCurrentUploadFileSize(targetFile.size);
        setCurrentUploadIndex({ current: index + 1, total: queue.length });
        const uploadController = new AbortController();
        abortControllerRef.current = uploadController;

        try {
          const outcome = await uploadSingleFile(
            targetFile,
            uploadCourseId,
            uploadAccessScope,
            uploadAcademicTermId,
            uploadController
          );
          if (outcome === 'processing') {
            processingCount += 1;
          } else {
            indexedCount += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Upload failed';
          const isAborted = uploadController.signal.aborted;
          if (message === 'Upload cancelled' || cancelUploadRef.current || isAborted) {
            break;
          }

          failedFiles.push(targetFile);
          toast.error(`${targetFile.name}: ${message}`);
        } finally {
          if (abortControllerRef.current === uploadController) {
            abortControllerRef.current = null;
          }
        }
      }

      if (cancelUploadRef.current) {
        setPendingFiles(queue.slice(index));
        toast.info('Upload cancelled');
        return;
      }

      setPendingFiles(failedFiles);

      if (indexedCount > 0 || processingCount > 0) {
        await onUploaded();
      }

      if (indexedCount > 0 && failedFiles.length === 0 && processingCount === 0) {
        toast.success(`${indexedCount} material${indexedCount === 1 ? '' : 's'} uploaded and indexed`);
      } else if (processingCount > 0 && indexedCount === 0 && failedFiles.length === 0) {
        toast.success(`${processingCount} material${processingCount === 1 ? '' : 's'} uploaded and queued for background processing`);
      } else if (indexedCount > 0 || processingCount > 0) {
        const totalSuccessCount = indexedCount + processingCount;
        toast.success(`${totalSuccessCount} material${totalSuccessCount === 1 ? '' : 's'} uploaded`);
      }

      if (processingCount > 0) {
        toast.info(`${processingCount} material${processingCount === 1 ? '' : 's'} ${processingCount === 1 ? 'is' : 'are'} still processing in the background. This list refreshes automatically.`);
      }

      if (failedFiles.length > 0) {
        toast.error(`${failedFiles.length} material${failedFiles.length === 1 ? '' : 's'} failed. Remove or retry.`);
      }
    } finally {
      setIsUploading(false);
      cancelUploadRef.current = false;
      abortControllerRef.current = null;
      setCurrentUploadFileName(null);
      setCurrentUploadStatusText(null);
      setCurrentUploadProgress(null);
      setCurrentUploadFileSize(null);
      setCurrentUploadIndex(null);
    }
  };

  return {
    pendingFiles,
    currentUploadFileName,
    currentUploadStatusText,
    currentUploadProgress,
    currentUploadFileSize,
    currentUploadIndex,
    isDragActive,
    isUploading,
    fileInputRef,
    getPendingFileKey,
    removePendingFile,
    handleFileInputChange,
    handleOpenFilePicker,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleCancelUpload,
    handleUpload,
    resetUploadSelection,
  };
}
