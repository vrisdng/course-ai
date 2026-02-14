import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Material {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number | null;
  processing_status: string;
  processing_error: string | null;
  course_id: string;
  topic: string | null;
  week_number: number | null;
  created_at: string;
}

interface UploadProgress {
  fileName: string;
  stage: 'uploading' | 'parsing' | 'embedding' | 'done' | 'error';
  progress: number; // 0–100
  error?: string;
  statusText?: string;
}

const ACCEPTED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'other',
  'image/jpeg': 'other',
  'image/webp': 'other',
  'image/gif': 'other',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'notes',
  'application/msword': 'notes',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slides',
};

const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.pptx';
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

export function useMaterials(courseId: string | null) {
  const { session } = useAuth();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploads, setUploads] = useState<Map<string, UploadProgress>>(new Map());

  const fetchMaterials = useCallback(async () => {
    if (!courseId) {
      setMaterials([]);
      setIsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('materials')
      .select('*')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching materials:', error);
      toast.error('Failed to load materials');
    } else {
      setMaterials(data || []);
    }
    setIsLoading(false);
  }, [courseId]);

  useEffect(() => {
    fetchMaterials();
  }, [fetchMaterials]);

  const updateUpload = (id: string, update: Partial<UploadProgress>) => {
    setUploads((prev) => {
      const next = new Map(prev);
      const current = next.get(id);
      if (current) {
        next.set(id, { ...current, ...update });
      }
      return next;
    });
  };

  const uploadFile = async (file: File) => {
    if (!courseId || !session) {
      toast.error('No course selected or not logged in');
      return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const typeFromExtension: Record<string, string> = {
      pdf: 'pdf',
      png: 'other',
      jpg: 'other',
      jpeg: 'other',
      webp: 'other',
      gif: 'other',
      doc: 'notes',
      docx: 'notes',
      pptx: 'slides',
      md: 'notes',
      markdown: 'notes',
      txt: 'notes',
      csv: 'notes',
      json: 'notes',
      ts: 'code',
      tsx: 'code',
      js: 'code',
      jsx: 'code',
      py: 'code',
      java: 'code',
      go: 'code',
      rb: 'code',
      rs: 'code',
      c: 'code',
      cpp: 'code',
      sql: 'code',
    };

    const fileType = ACCEPTED_TYPES[file.type] || typeFromExtension[extension];
    if (!fileType) {
      const label = file.type ? file.type : extension || 'unknown';
      toast.error(`Unsupported file type: ${label}`);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is 15MB.`);
      return;
    }

    const uploadId = `${file.name}-${Date.now()}`;
    let processingHintTimeouts: ReturnType<typeof setTimeout>[] = [];
    setUploads((prev) => {
      const next = new Map(prev);
      next.set(uploadId, {
        fileName: file.name,
        stage: 'uploading',
        progress: 10,
        statusText: 'Collecting your file...',
      });
      return next;
    });

    try {
      // 1. Upload to storage
      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
      const storagePath = `${courseId}/${Date.now()}-${file.name}`;

      const { error: storageError } = await supabase.storage
        .from('course-materials')
        .upload(storagePath, file);

      if (storageError) throw new Error(`Upload failed: ${storageError.message}`);

      updateUpload(uploadId, {
        stage: 'uploading',
        progress: 40,
        statusText: 'Saving your file...',
      });

      // 2. Create material record
      const { data: material, error: materialError } = await supabase
        .from('materials')
        .insert({
          course_id: courseId,
          file_name: file.name,
          file_path: storagePath,
          file_type: fileType as any,
          file_size: file.size,
          processing_status: 'pending' as any,
        })
        .select()
        .single();

      if (materialError || !material) {
        throw new Error(`Failed to create material record: ${materialError?.message}`);
      }

      updateUpload(uploadId, {
        stage: 'parsing',
        progress: 50,
        statusText: 'Reading the material...',
      });

      processingHintTimeouts = [
        setTimeout(() => {
          updateUpload(uploadId, {
            stage: 'parsing',
            progress: 62,
            statusText: 'Organizing the content...',
          });
        }, 1200),
        setTimeout(() => {
          updateUpload(uploadId, {
            stage: 'embedding',
            progress: 78,
            statusText: 'Synthesizing it for quick answers...',
          });
        }, 2800),
        setTimeout(() => {
          updateUpload(uploadId, {
            stage: 'embedding',
            progress: 90,
            statusText: 'Finishing up...',
          });
        }, 5000),
      ];

      // 3. Call parse-document edge function
      const { data: parseResult, error: parseError } = await supabase.functions.invoke(
        'parse-document',
        {
          body: {
            materialId: material.id,
            filePath: storagePath,
            fileType: ext,
          },
        }
      );
      processingHintTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));

      if (parseError) {
        throw new Error(`Processing failed: ${parseError.message}`);
      }

      if (parseResult?.error) {
        throw new Error(parseResult.error);
      }

      updateUpload(uploadId, {
        stage: 'done',
        progress: 100,
        statusText: 'Ready for student questions',
      });
      toast.success(`${file.name} is ready for questions`);

      // Refresh materials list
      await fetchMaterials();

      // Remove upload from tracker after a short delay
      setTimeout(() => {
        setUploads((prev) => {
          const next = new Map(prev);
          next.delete(uploadId);
          return next;
        });
      }, 3000);
    } catch (error) {
      processingHintTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
      const message = error instanceof Error ? error.message : 'Upload failed';
      console.error('Upload error:', error);
      updateUpload(uploadId, { stage: 'error', progress: 0, error: message });
      toast.error(message);
    }
  };

  const deleteMaterial = async (materialId: string) => {
    const material = materials.find((m) => m.id === materialId);
    if (!material) return;

    try {
      // Delete chunks first
      const { error: chunksError } = await supabase
        .from('chunks')
        .delete()
        .eq('material_id', materialId);

      if (chunksError) {
        console.error('Error deleting chunks:', chunksError);
      }

      // Delete material record
      const { error: materialError } = await supabase
        .from('materials')
        .delete()
        .eq('id', materialId);

      if (materialError) throw materialError;

      // Delete from storage
      await supabase.storage.from('course-materials').remove([material.file_path]);

      toast.success(`${material.file_name} deleted`);
      await fetchMaterials();
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Failed to delete material');
    }
  };

  return {
    materials,
    isLoading,
    uploads,
    uploadFile,
    deleteMaterial,
    refreshMaterials: fetchMaterials,
    acceptedExtensions: ACCEPTED_EXTENSIONS,
  };
}
