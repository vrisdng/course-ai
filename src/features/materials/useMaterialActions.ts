import { useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import type { Material, TranscriptSegment } from './types';

interface UseMaterialActionsOptions {
  onMaterialsChanged: () => Promise<void> | void;
  setMaterials: React.Dispatch<React.SetStateAction<Material[]>>;
}

export function useMaterialActions({ onMaterialsChanged, setMaterials }: UseMaterialActionsOptions) {
  const [linkedUrlMaterial, setLinkedUrlMaterial] = useState<Material | null>(null);
  const [linkedUrlValue, setLinkedUrlValue] = useState('');
  const [isSavingLinkedUrl, setIsSavingLinkedUrl] = useState(false);

  const [transcriptMaterial, setTranscriptMaterial] = useState<Material | null>(null);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);

  const [editingFileNameMaterial, setEditingFileNameMaterial] = useState<Material | null>(null);
  const [editingFileNameValue, setEditingFileNameValue] = useState('');
  const [isUpdatingFileName, setIsUpdatingFileName] = useState(false);

  const [reindexingIds, setReindexingIds] = useState<Set<string>>(new Set());

  const handleAttachLink = (material: Material) => {
    setLinkedUrlMaterial(material);
    setLinkedUrlValue(material.linked_url ?? '');
  };

  const closeLinkedUrlDialog = () => {
    if (isSavingLinkedUrl) return;
    setLinkedUrlMaterial(null);
    setLinkedUrlValue('');
  };

  const handleSaveLinkedUrl = async () => {
    if (!linkedUrlMaterial) return;
    setIsSavingLinkedUrl(true);

    const trimmed = linkedUrlValue.trim() || null;
    const { error } = await supabase
      .from('materials')
      .update({ linked_url: trimmed })
      .eq('id', linkedUrlMaterial.id);

    if (error) {
      toast.error(error.message || 'Failed to save URL');
      setIsSavingLinkedUrl(false);
      return;
    }

    setMaterials((prev) =>
      prev.map((m) => (m.id === linkedUrlMaterial.id ? { ...m, linked_url: trimmed } : m))
    );
    toast.success('URL saved');
    setIsSavingLinkedUrl(false);
    setLinkedUrlMaterial(null);
    setLinkedUrlValue('');
  };

  const handleOpenTranscript = async (material: Material) => {
    setTranscriptMaterial(material);
    setTranscriptSegments([]);
    setIsLoadingTranscript(true);

    const { data, error } = await supabase
      .from('material_transcript_segments')
      .select('id, segment_index, start_ms, end_ms, text')
      .eq('material_id', material.id)
      .order('segment_index', { ascending: true });

    if (error) {
      toast.error(error.message || 'Failed to load transcript');
      setIsLoadingTranscript(false);
      return;
    }

    setTranscriptSegments((data || []) as TranscriptSegment[]);
    setIsLoadingTranscript(false);
  };

  const closeTranscriptDialog = () => {
    setTranscriptMaterial(null);
    setTranscriptSegments([]);
    setIsLoadingTranscript(false);
  };

  const openEditFileNameDialog = (material: Material) => {
    setEditingFileNameMaterial(material);
    setEditingFileNameValue(material.file_name);
  };

  const closeEditFileNameDialog = () => {
    if (isUpdatingFileName) {
      return;
    }

    setEditingFileNameMaterial(null);
    setEditingFileNameValue('');
  };

  const handleUpdateFileName = async () => {
    if (!editingFileNameMaterial) {
      return;
    }

    const nextFileName = editingFileNameValue.trim();
    if (!nextFileName) {
      toast.error('Filename is required');
      return;
    }

    if (nextFileName === editingFileNameMaterial.file_name) {
      closeEditFileNameDialog();
      return;
    }

    setIsUpdatingFileName(true);
    const { error } = await supabase
      .from('materials')
      .update({ file_name: nextFileName })
      .eq('id', editingFileNameMaterial.id);

    if (error) {
      setIsUpdatingFileName(false);
      toast.error(error.message || 'Failed to update filename');
      return;
    }

    setMaterials((previous) =>
      previous.map((material) =>
        material.id === editingFileNameMaterial.id
          ? { ...material, file_name: nextFileName }
          : material
      )
    );
    setTranscriptMaterial((current) =>
      current?.id === editingFileNameMaterial.id
        ? { ...current, file_name: nextFileName }
        : current
    );
    setIsUpdatingFileName(false);
    setEditingFileNameMaterial(null);
    setEditingFileNameValue('');
    toast.success('Filename updated');
  };

  const handleReindexMaterial = async (material: Material) => {
    setReindexingIds((prev) => new Set(prev).add(material.id));
    try {
      const { data, error } = await supabase.functions.invoke('transcribe-video', {
        body: { materialId: material.id, refinalize: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Re-indexing "${material.file_name}" — this may take a few minutes.`);
      await onMaterialsChanged();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Re-index failed';
      toast.error(message);
    } finally {
      setReindexingIds((prev) => {
        const next = new Set(prev);
        next.delete(material.id);
        return next;
      });
    }
  };

  const handleDeleteMaterial = async (material: Material) => {
    const shouldDelete = window.confirm(`Delete ${material.file_name}? This cannot be undone.`);
    if (!shouldDelete) {
      return;
    }

    const { error: chunksError } = await supabase.from('chunks').delete().eq('material_id', material.id);
    if (chunksError) {
      toast.error(chunksError.message);
      return;
    }

    const { error: materialError } = await supabase.from('materials').delete().eq('id', material.id);
    if (materialError) {
      toast.error(materialError.message);
      return;
    }

    await supabase.storage.from('course-materials').remove([material.file_path]);
    toast.success('Document deleted');
    await onMaterialsChanged();
  };

  return {
    linkedUrlMaterial,
    linkedUrlValue,
    setLinkedUrlValue,
    isSavingLinkedUrl,
    handleAttachLink,
    closeLinkedUrlDialog,
    handleSaveLinkedUrl,

    transcriptMaterial,
    transcriptSegments,
    isLoadingTranscript,
    handleOpenTranscript,
    closeTranscriptDialog,

    editingFileNameMaterial,
    editingFileNameValue,
    setEditingFileNameValue,
    isUpdatingFileName,
    openEditFileNameDialog,
    closeEditFileNameDialog,
    handleUpdateFileName,

    reindexingIds,
    handleReindexMaterial,
    handleDeleteMaterial,
  };
}
