import { useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';

interface UseBulkDeleteMaterialsOptions {
  // Called after at least one material was deleted, before the workflow resets,
  // so the caller can refresh its list and clear its selection.
  onDeleted: () => Promise<unknown> | unknown;
}

// The columns the delete flow needs, fetched fresh so a selection that spans
// pages (or outlived a refresh) still deletes the right kind of material.
interface BulkDeleteMaterialRow {
  id: string;
  file_type: string | null;
  file_path: string | null;
  video_upload_state: string | null;
}

function isStoredVideo(row: BulkDeleteMaterialRow) {
  return row.file_type === 'video' && Boolean(row.video_upload_state);
}

function materialCountLabel(count: number) {
  return `${count} material${count === 1 ? '' : 's'}`;
}

// Deletes a set of selected materials in bulk: documents (and their chunks and
// stored files) go in one batch, stored videos are deleted provider-aware via
// video-upload-session, one call each. Mirrors the single-material flow in
// useMaterialActions.handleDeleteMaterial.
export function useBulkDeleteMaterials({ onDeleted }: UseBulkDeleteMaterialsOptions) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const openDialog = () => setIsDialogOpen(true);

  const closeDialog = () => {
    if (!isDeleting) setIsDialogOpen(false);
  };

  const deleteSelected = async (materialIds: string[]) => {
    if (materialIds.length === 0 || isDeleting) return;

    setIsDeleting(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('materials')
        .select('id, file_type, file_path, video_upload_state')
        .in('id', materialIds);

      if (fetchError) {
        toast.error(fetchError.message || 'Failed to load the selected materials');
        return;
      }

      const rows = (data ?? []) as BulkDeleteMaterialRow[];
      if (rows.length === 0) {
        toast.error('The selected materials could not be found');
        return;
      }

      const videos = rows.filter(isStoredVideo);
      const documents = rows.filter((row) => !isStoredVideo(row));
      const failedVideoIds: string[] = [];

      if (documents.length > 0) {
        const documentIds = documents.map((row) => row.id);

        const { error: chunksError } = await supabase
          .from('chunks')
          .delete()
          .in('material_id', documentIds);
        if (chunksError) {
          toast.error(chunksError.message || 'Failed to delete the indexed chunks');
          return;
        }

        const { error: materialsError } = await supabase.from('materials').delete().in('id', documentIds);
        if (materialsError) {
          toast.error(materialsError.message || 'Failed to delete the documents');
          return;
        }

        // Best-effort, like single deletion; converted and page-image objects
        // are not removed (same known gap as single delete).
        const filePaths = [...new Set(documents.map((row) => row.file_path).filter((path) => Boolean(path)))];
        if (filePaths.length > 0) {
          await supabase.storage.from('course-materials').remove(filePaths);
        }
      }

      for (const video of videos) {
        try {
          const { data: result, error } = await supabase.functions.invoke('video-upload-session', {
            body: { action: 'delete', materialId: video.id },
          });
          if (error) throw error;
          if (result?.error) throw new Error(result.error);
        } catch {
          failedVideoIds.push(video.id);
        }
      }

      const failedCount = failedVideoIds.length;
      const deletedCount = rows.length - failedCount;

      if (failedCount === 0) {
        toast.success(`Deleted ${materialCountLabel(rows.length)}`);
      } else if (deletedCount > 0) {
        toast.error(`Deleted ${materialCountLabel(deletedCount)}, but ${failedCount} failed to delete`);
      } else {
        toast.error(`Failed to delete ${materialCountLabel(failedCount)}`);
      }

      if (failedCount < rows.length) {
        setIsDialogOpen(false);
        await onDeleted();
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    isDialogOpen,
    isDeleting,
    openDialog,
    closeDialog,
    deleteSelected,
  };
}
