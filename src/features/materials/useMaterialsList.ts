import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import type { Material } from './types';

const MATERIALS_PAGE_SIZE = 10;

export function useMaterialsList() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('all');
  const [academicTermFilter, setAcademicTermFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const [documentTypeFilter, setDocumentTypeFilter] = useState('all');
  const [materialsPage, setMaterialsPage] = useState(1);
  const [totalMaterialsCount, setTotalMaterialsCount] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  const fetchMaterials = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoadingMaterials(true);
    }

    const rangeFrom = (materialsPage - 1) * MATERIALS_PAGE_SIZE;
    const rangeTo = rangeFrom + MATERIALS_PAGE_SIZE - 1;
    const normalizedSearchQuery = deferredSearchQuery.trim();
    const createdAfter = (() => {
      const now = new Date();
      if (dateFilter === 'last_7_days') {
        now.setDate(now.getDate() - 7);
        return now.toISOString();
      }
      if (dateFilter === 'last_30_days') {
        now.setDate(now.getDate() - 30);
        return now.toISOString();
      }
      if (dateFilter === 'this_year') {
        return new Date(now.getFullYear(), 0, 1).toISOString();
      }
      return null;
    })();

    let query: any = supabase
      .from('materials')
      .select(
        'id, course_id, duration_ms, file_name, file_path, file_type, file_size, linked_url, topic, week_number, processing_error, processing_progress, processing_stage, processing_status, access_scope, academic_term_id, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    if (courseFilter !== 'all') {
      query = query.eq('course_id', courseFilter);
    }
    if (academicTermFilter !== 'all') {
      query = query.eq('academic_term_id', academicTermFilter);
    }
    if (statusFilter !== 'all') {
      query = query.eq('processing_status', statusFilter);
    }
    if (accessFilter !== 'all') {
      query = query.eq('access_scope', accessFilter);
    }
    if (documentTypeFilter === 'video') {
      query = query.eq('file_type', 'video');
    } else if (documentTypeFilter === 'notes') {
      query = query.in('file_type', ['notes', 'pdf', 'slides']);
    }
    if (createdAfter) {
      query = query.gte('created_at', createdAfter);
    }
    if (normalizedSearchQuery) {
      const escapedSearch = normalizedSearchQuery.replace(/[%_,]/g, (character) => `\\${character}`);
      query = query.or(`file_name.ilike.%${escapedSearch}%,topic.ilike.%${escapedSearch}%`);
    }

    const { data, error, count } = await query.range(rangeFrom, rangeTo);

    if (error) {
      toast.error('Failed to load materials');
      if (!options?.silent) {
        setIsLoadingMaterials(false);
      }
      return;
    }

    setMaterials((data || []) as Material[]);
    setTotalMaterialsCount(count || 0);
    if (!options?.silent) {
      setIsLoadingMaterials(false);
    }
  }, [
    academicTermFilter,
    accessFilter,
    courseFilter,
    dateFilter,
    deferredSearchQuery,
    documentTypeFilter,
    materialsPage,
    statusFilter,
  ]);

  useEffect(() => {
    void fetchMaterials();
  }, [fetchMaterials]);

  useEffect(() => {
    setMaterialsPage(1);
  }, [academicTermFilter, accessFilter, courseFilter, dateFilter, documentTypeFilter, searchQuery, statusFilter]);

  const totalMaterialPages = Math.max(1, Math.ceil(totalMaterialsCount / MATERIALS_PAGE_SIZE));

  useEffect(() => {
    if (materialsPage > totalMaterialPages) {
      setMaterialsPage(totalMaterialPages);
    }
  }, [materialsPage, totalMaterialPages]);

  const hasBackgroundProcessing = useMemo(
    () => materials.some((material) => material.processing_status === 'processing'),
    [materials]
  );

  useEffect(() => {
    if (!hasBackgroundProcessing) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchMaterials({ silent: true });
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [fetchMaterials, hasBackgroundProcessing]);

  const visibleMaterialRangeStart = totalMaterialsCount === 0 ? 0 : (materialsPage - 1) * MATERIALS_PAGE_SIZE + 1;
  const visibleMaterialRangeEnd = totalMaterialsCount === 0
    ? 0
    : Math.min(materialsPage * MATERIALS_PAGE_SIZE, totalMaterialsCount);

  return {
    materials,
    setMaterials,
    isLoadingMaterials,
    fetchMaterials,
    searchQuery,
    setSearchQuery,
    courseFilter,
    setCourseFilter,
    academicTermFilter,
    setAcademicTermFilter,
    statusFilter,
    setStatusFilter,
    dateFilter,
    setDateFilter,
    accessFilter,
    setAccessFilter,
    documentTypeFilter,
    setDocumentTypeFilter,
    showFilters,
    setShowFilters,
    materialsPage,
    setMaterialsPage,
    totalMaterialsCount,
    totalMaterialPages,
    visibleMaterialRangeStart,
    visibleMaterialRangeEnd,
  };
}
