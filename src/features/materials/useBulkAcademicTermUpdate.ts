import { useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';

interface UseBulkAcademicTermUpdateOptions {
  onUpdated: () => Promise<unknown> | unknown;
}

export function useBulkAcademicTermUpdate({ onUpdated }: UseBulkAcademicTermUpdateOptions) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [targetAcademicTermId, setTargetAcademicTermId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const startSelecting = () => setIsSelecting(true);

  const cancelSelecting = () => {
    setIsSelecting(false);
    setSelectedMaterialIds(new Set());
    setIsDialogOpen(false);
    setTargetAcademicTermId('');
  };

  const toggleMaterial = (materialId: string) => {
    setSelectedMaterialIds((current) => {
      const next = new Set(current);
      if (next.has(materialId)) next.delete(materialId);
      else next.add(materialId);
      return next;
    });
  };

  const togglePage = (materialIds: string[], checked: boolean) => {
    setSelectedMaterialIds((current) => {
      const next = new Set(current);
      materialIds.forEach((materialId) => {
        if (checked) next.add(materialId);
        else next.delete(materialId);
      });
      return next;
    });
  };

  const openDialog = () => {
    if (selectedMaterialIds.size === 0) return;
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    if (!isSaving) setIsDialogOpen(false);
  };

  const save = async () => {
    if (!targetAcademicTermId || selectedMaterialIds.size === 0) return;

    setIsSaving(true);
    const materialIds = Array.from(selectedMaterialIds);
    const { error } = await supabase
      .from('materials')
      .update({ academic_term_id: targetAcademicTermId })
      .in('id', materialIds);

    if (error) {
      toast.error(error.message);
      setIsSaving(false);
      return;
    }

    await onUpdated();
    toast.success(`Academic term updated for ${materialIds.length} material${materialIds.length === 1 ? '' : 's'}`);
    setIsSaving(false);
    cancelSelecting();
  };

  return {
    isSelecting,
    selectedMaterialIds,
    isDialogOpen,
    targetAcademicTermId,
    isSaving,
    startSelecting,
    cancelSelecting,
    toggleMaterial,
    togglePage,
    openDialog,
    closeDialog,
    setTargetAcademicTermId,
    save,
  };
}
