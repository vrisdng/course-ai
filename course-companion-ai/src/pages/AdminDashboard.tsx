import { createClient } from '@supabase/supabase-js';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Ellipsis,
  FileText,
  Filter,
  Globe2,
  Loader2,
  Lock,
  Pencil,
  Search,
  Trash2,
  UploadCloud,
  Users2,
  Video,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import {
  INLINE_GEMINI_MAX_FILE_SIZE_BYTES,
  getDeferredUploadValidationError,
  getImmediateUploadValidationError,
  isTextLikeUpload,
  isVideoUpload,
} from '@/lib/materialUpload';
import { uploadToStorageWithProgress } from '@/lib/uploadWithProgress';
import { cn } from '@/lib/utils';
import { uploadVideoForTranscription } from '@/lib/videoUploadPipeline';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const ACCEPTED_FILE_TYPES =
  '.txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.java,.go,.rb,.rs,.c,.cpp,.html,.css,.sql,.pdf,.doc,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm';

const SUPPORTED_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'pptx',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'java',
  'go',
  'rb',
  'rs',
  'c',
  'cpp',
  'html',
  'css',
  'sql',
  'mp4',
  'webm',
]);

type Course = {
  id: string;
  name: string;
  code: string | null;
};

type AcademicTerm = {
  id: string;
  label: string;
  semester: number;
  academic_year_start: number;
  academic_year_end: number;
  sort_key: number;
  is_active: boolean;
};

type MaterialStatus = 'pending' | 'processing' | 'completed' | 'failed';
type AccessScope = 'course' | 'public' | 'private';
type InviteStatus = 'created' | 'existing_invite' | 'already_enrolled' | 'invalid_email';

type Material = {
  id: string;
  course_id: string;
  duration_ms?: number | null;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number | null;
  topic: string | null;
  week_number: number | null;
  processing_error?: string | null;
  processing_progress?: number | null;
  processing_stage?: string | null;
  processing_status: MaterialStatus;
  access_scope: AccessScope;
  academic_term_id: string | null;
  created_at: string;
};

type InviteResult = {
  email: string;
  status: InviteStatus;
  inviteCode: string | null;
  inviteLink: string | null;
};

type TranscriptSegment = {
  id: string;
  segment_index: number;
  start_ms: number;
  end_ms: number;
  text: string;
};

type UploadOutcome = 'indexed' | 'processing';

const getFileType = (fileName: string) => {
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
};

const formatBytes = (bytes: number | null) => {
  if (!bytes && bytes !== 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

const formatDuration = (durationMs: number | null | undefined) => {
  if (typeof durationMs !== 'number' || durationMs <= 0) {
    return null;
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatTimestamp = (timestampMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const isFileSupported = (candidate: File) => {
  const extension = candidate.name.split('.').pop()?.toLowerCase() || '';
  return candidate.type.startsWith('text/') || SUPPORTED_EXTENSIONS.has(extension);
};

export default function AdminDashboard() {
  const { profile } = useAuth();

  const [courses, setCourses] = useState<Course[]>([]);
  const [academicTerms, setAcademicTerms] = useState<AcademicTerm[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);

  const [uploadCourseId, setUploadCourseId] = useState<string>('');
  const [uploadAcademicTermId, setUploadAcademicTermId] = useState<string>('');
  const [uploadAccessScope, setUploadAccessScope] = useState<AccessScope | ''>('');
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');
  const [newCourseDescription, setNewCourseDescription] = useState('');
  const [newTermSemester, setNewTermSemester] = useState<'1' | '2'>('1');
  const [newTermAyStart, setNewTermAyStart] = useState<string>(String(new Date().getFullYear()));

  const [searchQuery, setSearchQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('all');
  const [academicTermFilter, setAcademicTermFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [currentUploadFileName, setCurrentUploadFileName] = useState<string | null>(null);
  const [currentUploadStatusText, setCurrentUploadStatusText] = useState<string | null>(null);
  const [currentUploadProgress, setCurrentUploadProgress] = useState<number | null>(null);
  const [currentUploadFileSize, setCurrentUploadFileSize] = useState<number | null>(null);
  const [currentUploadIndex, setCurrentUploadIndex] = useState<{ current: number; total: number } | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [isLoadingTerms, setIsLoadingTerms] = useState(true);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [isCreatingTerm, setIsCreatingTerm] = useState(false);
  const [activatingTermId, setActivatingTermId] = useState<string | null>(null);
  const [addStudentsCourse, setAddStudentsCourse] = useState<Course | null>(null);
  const [inviteEmailsInput, setInviteEmailsInput] = useState('');
  const [isGeneratingInvites, setIsGeneratingInvites] = useState(false);
  const [generatedInviteResults, setGeneratedInviteResults] = useState<InviteResult[]>([]);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [transcriptMaterial, setTranscriptMaterial] = useState<Material | null>(null);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  const [editingFileNameMaterial, setEditingFileNameMaterial] = useState<Material | null>(null);
  const [editingFileNameValue, setEditingFileNameValue] = useState('');
  const [isUpdatingFileName, setIsUpdatingFileName] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cancelUploadRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const supabaseAbortable = useMemo(
    () =>
      createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          storage: localStorage,
          persistSession: true,
          autoRefreshToken: true,
        },
        global: {
          fetch: (input, init = {}) => {
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

  const fetchCourses = useCallback(async () => {
    setIsLoadingCourses(true);
    const { data, error } = await supabase.from('courses').select('id, name, code').order('name');

    if (error) {
      toast.error('Failed to load courses');
      setIsLoadingCourses(false);
      return;
    }

    const nextCourses = (data || []) as Course[];
    setCourses(nextCourses);
    setUploadCourseId((current) => (current && nextCourses.some((course) => course.id === current) ? current : ''));
    setIsLoadingCourses(false);
  }, []);

  const fetchAcademicTerms = useCallback(async () => {
    setIsLoadingTerms(true);

    const { data, error } = await supabase
      .from('academic_terms')
      .select('id, label, semester, academic_year_start, academic_year_end, sort_key, is_active')
      .order('sort_key', { ascending: false });

    if (error) {
      toast.error('Failed to load academic terms');
      setIsLoadingTerms(false);
      return;
    }

    const nextTerms = (data || []) as AcademicTerm[];
    setAcademicTerms(nextTerms);

    const activeTermId = nextTerms.find((term) => term.is_active)?.id || nextTerms[0]?.id || '';
    setUploadAcademicTermId((current) =>
      current && nextTerms.some((term) => term.id === current) ? current : activeTermId
    );

    setIsLoadingTerms(false);
  }, []);

  const fetchMaterials = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoadingMaterials(true);
    }

    const { data, error } = await supabase
      .from('materials')
      .select('id, course_id, duration_ms, file_name, file_path, file_type, file_size, topic, week_number, processing_error, processing_progress, processing_stage, processing_status, access_scope, academic_term_id, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      const fallback = await supabase
        .from('materials')
        .select('id, course_id, duration_ms, file_name, file_path, file_type, file_size, topic, week_number, processing_error, processing_progress, processing_stage, processing_status, is_public, created_at')
        .order('created_at', { ascending: false })
        .limit(200);

      if (fallback.error) {
        toast.error('Failed to load materials');
        if (!options?.silent) {
          setIsLoadingMaterials(false);
        }
        return;
      }

      const fallbackMaterials = (fallback.data || []).map((material: any) => ({
        ...material,
        access_scope: material.is_public ? 'public' : 'course',
        academic_term_id: null,
      })) as Material[];

      setMaterials(fallbackMaterials);
      if (!options?.silent) {
        setIsLoadingMaterials(false);
      }
      return;
    }

    setMaterials((data || []) as Material[]);
    if (!options?.silent) {
      setIsLoadingMaterials(false);
    }
  }, []);

  useEffect(() => {
    void fetchCourses();
    void fetchAcademicTerms();
    void fetchMaterials();
  }, [fetchAcademicTerms, fetchCourses, fetchMaterials]);

  const courseLabelById = useMemo(() => {
    return courses.reduce<Record<string, string>>((acc, course) => {
      acc[course.id] = `${course.name}${course.code ? ` (${course.code})` : ''}`;
      return acc;
    }, {});
  }, [courses]);

  const termLabelById = useMemo(() => {
    return academicTerms.reduce<Record<string, string>>((acc, term) => {
      acc[term.id] = term.label;
      return acc;
    }, {});
  }, [academicTerms]);

  const getUploadSetupError = () => {
    if (!uploadCourseId) {
      return 'Select the course for this document first';
    }

    if (!uploadAcademicTermId) {
      return 'Select the academic term first';
    }

    if (!uploadAccessScope) {
      return 'Choose who can access this document first';
    }

    return null;
  };

  const uploadSetupError = getUploadSetupError();
  const isUploadSetupComplete = uploadSetupError === null;
  const documentLimitMb = Math.round(INLINE_GEMINI_MAX_FILE_SIZE_BYTES / 1024 / 1024);

  const uploadChecklistItems = [
    {
      id: 'course',
      label: 'Select course',
      isDone: Boolean(uploadCourseId),
      detail: uploadCourseId ? courseLabelById[uploadCourseId] || 'Course selected' : 'Choose the course these files belong to.',
    },
    {
      id: 'term',
      label: 'Select academic term',
      isDone: Boolean(uploadAcademicTermId),
      detail: uploadAcademicTermId
        ? termLabelById[uploadAcademicTermId] || 'Academic term selected'
        : 'Pick the academic term for this upload.',
    },
    {
      id: 'access',
      label: 'Choose accessibility',
      isDone: Boolean(uploadAccessScope),
      detail: uploadAccessScope ? accessScopeLabel(uploadAccessScope) : 'Choose whether this stays course-only or private.',
    },
  ];

  const filteredMaterials = useMemo(() => {
    const now = new Date();

    return materials.filter((material) => {
      const haystack = `${material.file_name} ${material.topic || ''}`.toLowerCase();
      const searchMatch = !searchQuery.trim() || haystack.includes(searchQuery.trim().toLowerCase());
      const courseMatch = courseFilter === 'all' || material.course_id === courseFilter;
      const academicTermMatch = academicTermFilter === 'all' || material.academic_term_id === academicTermFilter;
      const statusMatch = statusFilter === 'all' || material.processing_status === statusFilter;
      const accessMatch = accessFilter === 'all' || material.access_scope === accessFilter;

      let dateMatch = true;
      if (dateFilter !== 'all') {
        const created = new Date(material.created_at);
        if (dateFilter === 'last_7_days') {
          const dayDiff = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
          dateMatch = dayDiff <= 7;
        } else if (dateFilter === 'last_30_days') {
          const dayDiff = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
          dateMatch = dayDiff <= 30;
        } else if (dateFilter === 'this_year') {
          dateMatch = created.getFullYear() === now.getFullYear();
        }
      }

      return searchMatch && courseMatch && academicTermMatch && statusMatch && accessMatch && dateMatch;
    });
  }, [accessFilter, academicTermFilter, courseFilter, dateFilter, materials, searchQuery, statusFilter]);

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

  const getPendingFileKey = (candidate: File) =>
    `${candidate.name}-${candidate.size}-${candidate.lastModified}`;

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

  const addPendingFiles = (candidates: File[]) => {
    if (!candidates.length) {
      return;
    }

    if (uploadSetupError) {
      toast.error(uploadSetupError);
      return;
    }

    const unsupported: string[] = [];
    const oversized: string[] = [];
    let addedCount = 0;

    setPendingFiles((previous) => {
      const keys = new Set(previous.map((item) => getPendingFileKey(item)));
      const next = [...previous];

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
        if (keys.has(key)) {
          continue;
        }

        keys.add(key);
        next.push(candidate);
        addedCount += 1;
      }

      return next;
    });

    if (unsupported.length > 0) {
      toast.error(`Skipped ${unsupported.length} unsupported file${unsupported.length === 1 ? '' : 's'}.`);
    }

    if (oversized.length > 0) {
      toast.error(
        `Skipped ${oversized.length} file${oversized.length === 1 ? '' : 's'} that exceed the upload limits for document or video processing.`
      );
    }

    if (addedCount === 0 && unsupported.length === 0 && oversized.length === 0) {
      toast.info('These files are already in your review list.');
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    addPendingFiles(Array.from(event.target.files || []));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOpenFilePicker = () => {
    if (uploadSetupError && !isUploading) {
      toast.error(uploadSetupError);
      return;
    }

    if (!isUploading && isUploadSetupComplete) {
      fileInputRef.current?.click();
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isUploading && isUploadSetupComplete) {
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);

    if (isUploading) {
      return;
    }

    if (uploadSetupError) {
      toast.error(uploadSetupError);
      return;
    }

    addPendingFiles(Array.from(event.dataTransfer.files || []));
  };

  useEffect(() => {
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
  }, [uploadAcademicTermId, uploadCourseId]);


  const handleCreateCourse = async () => {
    if (!profile) {
      toast.error('Profile not loaded');
      return;
    }
    if (!newCourseName.trim()) {
      toast.error('Course name is required');
      return;
    }

    setIsCreatingCourse(true);

    const { data, error } = await supabase
      .from('courses')
      .insert({
        name: newCourseName.trim(),
        description: newCourseDescription.trim() || null,
        code: newCourseCode.trim() || null,
        created_by: profile.id,
      })
      .select('id, name, code')
      .single();

    if (error) {
      toast.error(error.message);
      setIsCreatingCourse(false);
      return;
    }

    const createdCourse = data as Course;
    setCourses((prev) => [createdCourse, ...prev]);
    setUploadCourseId(createdCourse.id);
    setNewCourseName('');
    setNewCourseCode('');
    setNewCourseDescription('');
    setIsCreatingCourse(false);
    toast.success('Course created');
  };

  const formatAcademicTermLabel = (semester: number, ayStart: number) => {
    const start = String(ayStart).slice(-2);
    const end = String(ayStart + 1).slice(-2);
    return `Semester ${semester} AY${start}/${end}`;
  };

  const handleCreateAcademicTerm = async () => {
    if (!profile || profile.role !== 'admin') {
      toast.error('Only admins can create academic terms');
      return;
    }

    const ayStart = Number.parseInt(newTermAyStart, 10);
    if (!Number.isInteger(ayStart) || ayStart < 2000 || ayStart > 2999) {
      toast.error('Enter a valid academic year start (e.g. 2026)');
      return;
    }

    const semester = Number.parseInt(newTermSemester, 10);
    const label = formatAcademicTermLabel(semester, ayStart);

    setIsCreatingTerm(true);
    const { data, error } = await supabase
      .from('academic_terms')
      .insert({
        label,
        semester,
        academic_year_start: ayStart,
        academic_year_end: ayStart + 1,
        is_active: false,
      })
      .select('id')
      .single();

    if (error) {
      setIsCreatingTerm(false);
      toast.error(error.message.includes('duplicate') ? 'This academic term already exists' : error.message);
      return;
    }

    await fetchAcademicTerms();
    if (data?.id) {
      setUploadAcademicTermId(data.id);
    }
    setIsCreatingTerm(false);
    toast.success(`${label} created`);
  };

  const handleSetActiveTerm = async (termId: string) => {
    if (!profile || profile.role !== 'admin') {
      toast.error('Only admins can set the active term');
      return;
    }

    setActivatingTermId(termId);
    const { error } = await supabase.rpc('set_active_academic_term', { target_term_id: termId });

    if (error) {
      setActivatingTermId(null);
      toast.error(error.message);
      return;
    }

    await fetchAcademicTerms();
    setUploadAcademicTermId(termId);
    setActivatingTermId(null);
    toast.success('Active academic term updated');
  };

  const uploadSingleFile = async (
    targetFile: File,
    courseId: string,
    accessScope: AccessScope,
    uploaderId: string,
    academicTermId: string
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
      if (cancelUploadRef.current) throw new Error('Upload cancelled');

      // Use the AbortController already set by the upload loop
      if (!abortControllerRef.current) {
        abortControllerRef.current = new AbortController();
      }

      await uploadVideoForTranscription({
        file: targetFile,
        courseId,
        onProgress: (update) => {
          setCurrentUploadStatusText(update.statusText);
          setCurrentUploadProgress(update.progress);
        },
        signal: abortControllerRef.current.signal,
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
      signal: abortControllerRef.current?.signal,
      onProgress: (fraction) => {
        const pct = Math.round(fraction * 100);
        setCurrentUploadStatusText(`Uploading ${targetFile.name}... ${pct}%`);
        setCurrentUploadProgress(pct * 0.5); // upload is 0-50%, processing is 50-100%
      },
    });

    console.log('[admin-upload]', `Upload complete in ${((performance.now() - uploadStart) / 1000).toFixed(1)}s`);

    if (cancelUploadRef.current) {
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

    if (cancelUploadRef.current) {
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
        signal: abortControllerRef.current?.signal,
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
      signal: abortControllerRef.current?.signal,
    });

    if (parseError) {
      throw new Error(parseError.message || 'Failed to parse material');
    }

    if (parseResult?.error) {
      throw new Error(parseResult.error);
    }

    return parseResult?.queued ? 'processing' : 'indexed';
  };

  const handleUpload = async () => {
    if (!profile) {
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
    const courseId = uploadCourseId;
    const accessScope = uploadAccessScope;
    const uploaderId = profile.id;
    const academicTermId = uploadAcademicTermId;
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
        abortControllerRef.current = new AbortController();

        try {
          const outcome = await uploadSingleFile(targetFile, courseId, accessScope, uploaderId, academicTermId);
          if (outcome === 'processing') {
            processingCount += 1;
          } else {
            indexedCount += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Upload failed';
          const isAborted = abortControllerRef.current?.signal.aborted;
          if (message === 'Upload cancelled' || cancelUploadRef.current || isAborted) {
            break;
          }

          failedFiles.push(targetFile);
          toast.error(`${targetFile.name}: ${message}`);
        } finally {
          abortControllerRef.current = null;
        }
      }

      if (cancelUploadRef.current) {
        setPendingFiles(queue.slice(index));
        toast.info('Upload cancelled');
        return;
      }

      setPendingFiles(failedFiles);

      if (indexedCount > 0 || processingCount > 0) {
        await fetchMaterials();
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

  function accessScopeLabel(scope: AccessScope) {
    if (scope === 'course') return 'Course only';
    if (scope === 'public') return 'Everyone';
    return 'Private';
  }

  const renderAccessBadge = (scope: AccessScope) => {
    const icon = {
      course: <Users2 className="h-3.5 w-3.5" />,
      public: <Globe2 className="h-3.5 w-3.5" />,
      private: <Lock className="h-3.5 w-3.5" />,
    }[scope];

    const variant: Record<AccessScope, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      course: 'secondary',
      public: 'default',
      private: 'outline',
    };

    return (
      <Badge variant={variant[scope]} className="gap-1">
        {icon}
        {accessScopeLabel(scope)}
      </Badge>
    );
  };

  const removePendingFile = (fileKey: string) => {
    if (isUploading) {
      return;
    }
    setPendingFiles((previous) => previous.filter((candidate) => getPendingFileKey(candidate) !== fileKey));
  };

  const handleCancelUpload = () => {
    if (isUploading) {
      cancelUploadRef.current = true;
      abortControllerRef.current?.abort();
      return;
    }

    resetUploadSelection();
  };

  const handleOpenMaterial = async (material: Material) => {
    const { data, error } = await supabase.storage.from('course-materials').createSignedUrl(material.file_path, 120);

    if (error || !data?.signedUrl) {
      toast.error(error?.message || 'Failed to open document');
      return;
    }

    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
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
    await fetchMaterials();
  };

  const getProcessingStageLabel = (material: Material) => {
    const stage = material.processing_stage?.toLowerCase();

    if (material.processing_status === 'failed') {
      return 'Failed';
    }

    if (material.processing_status === 'completed') {
      return 'Completed';
    }

    if (stage === 'queueing') return 'Queueing';
    if (stage === 'chunking') return 'Chunking';
    if (stage === 'embedding') return 'Embedding';
    if (stage === 'transcribing') return 'Transcribing';
    if (stage === 'finalizing') return 'Finalizing';

    if (material.processing_status === 'processing') {
      return 'Processing';
    }

    return 'Pending';
  };

  const renderStatusBadge = (material: Material) => {
    const stageLabel = getProcessingStageLabel(material);
    const icon =
      material.processing_status === 'completed' ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
      ) : material.processing_status === 'failed' ? (
        <AlertCircle className="h-3.5 w-3.5 text-red-500" />
      ) : material.processing_status === 'pending' || material.processing_stage === 'queueing' ? (
        <Clock className="h-3.5 w-3.5 text-slate-500" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
      );

    const variant: 'default' | 'secondary' | 'destructive' | 'outline' =
      material.processing_status === 'completed'
        ? 'default'
        : material.processing_status === 'failed'
          ? 'destructive'
          : material.processing_status === 'pending'
            ? 'outline'
            : 'secondary';

    return (
      <Badge variant={variant} className="gap-1">
        {icon}
        {stageLabel}
      </Badge>
    );
  };

  const parsedInviteEmails = useMemo(() => {
    return Array.from(
      new Set(
        inviteEmailsInput
          .split(/[\s,;]+/)
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value.length > 0)
      )
    );
  }, [inviteEmailsInput]);

  const closeAddStudentsDialog = () => {
    setAddStudentsCourse(null);
    setInviteEmailsInput('');
    setGeneratedInviteResults([]);
    setInviteExpiresAt(null);
    setIsGeneratingInvites(false);
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  const inviteStatusLabel = (status: InviteStatus) => {
    if (status === 'created') return 'Invite ready';
    if (status === 'existing_invite') return 'Invite already exists';
    if (status === 'already_enrolled') return 'Already enrolled';
    return 'Invalid email';
  };

  const inviteStatusVariant = (status: InviteStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (status === 'created') return 'default';
    if (status === 'existing_invite') return 'secondary';
    if (status === 'already_enrolled') return 'outline';
    return 'destructive';
  };

  const handleGenerateInvites = async () => {
    if (!addStudentsCourse) {
      return;
    }
    if (parsedInviteEmails.length === 0) {
      toast.error('Enter at least one email');
      return;
    }

    setIsGeneratingInvites(true);
    setGeneratedInviteResults([]);
    setInviteExpiresAt(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) {
      setIsGeneratingInvites(false);
      toast.error('Please sign in again to generate invite codes');
      return;
    }

    const { data, error } = await supabase.functions.invoke('manage-course-invites', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        courseId: addStudentsCourse.id,
        emails: parsedInviteEmails,
      },
    });

    if (error) {
      setIsGeneratingInvites(false);
      toast.error(error.message || 'Failed to create invite codes');
      return;
    }

    if (data?.error) {
      setIsGeneratingInvites(false);
      toast.error(data.error);
      return;
    }

    const expiresAt = typeof data?.expiresAt === 'string' ? data.expiresAt : null;
    const baseUrl = window.location.origin;
    const results = (Array.isArray(data?.results) ? data.results : []).map((item: any) => {
      const inviteCode = typeof item?.inviteCode === 'string' ? item.inviteCode : null;
      const email = typeof item?.email === 'string' ? item.email : '';
      const inviteLink = inviteCode
        ? `${baseUrl}/?invite=${encodeURIComponent(inviteCode)}&email=${encodeURIComponent(email)}`
        : null;

      return {
        email,
        status: item?.status as InviteStatus,
        inviteCode,
        inviteLink,
      };
    });

    setInviteExpiresAt(expiresAt);
    setGeneratedInviteResults(results);
    setIsGeneratingInvites(false);

    const readyCount = results.filter((result) => result.status === 'created' || result.status === 'existing_invite').length;
    toast.success(`Invite codes ready for ${readyCount} student${readyCount === 1 ? '' : 's'}`);
  };

  const handleCopyAllInviteLinks = async () => {
    const lines = generatedInviteResults
      .filter((item) => item.inviteLink)
      .map((item) => `${item.email}, ${item.inviteLink}`);

    if (lines.length === 0) {
      toast.error('No invite links available to copy');
      return;
    }

    await copyText(lines.join('\n'));
  };

  return (
    <MainLayout showFooter={false}>
      <Dialog open={Boolean(transcriptMaterial)} onOpenChange={(open) => (open ? undefined : closeTranscriptDialog())}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Video Transcript</DialogTitle>
            <DialogDescription>
              {transcriptMaterial
                ? `Timestamped transcript extracted from ${transcriptMaterial.file_name}.`
                : 'Timestamped transcript extracted from this video.'}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="h-[60vh] space-y-3 overflow-y-auto pr-1">
            {isLoadingTranscript ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading transcript...
              </div>
            ) : transcriptSegments.length === 0 ? (
              <div className="rounded-md border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                No transcript segments were found for this video yet.
              </div>
            ) : (
              <div className="space-y-2">
                {transcriptSegments.map((segment) => (
                  <div key={segment.id} className="rounded-md border border-border bg-muted/20 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-primary">
                        {formatTimestamp(segment.start_ms)}-{formatTimestamp(segment.end_ms)}
                      </span>
                      <span className="text-xs text-muted-foreground">Segment {segment.segment_index + 1}</span>
                    </div>
                    <p className="text-sm text-foreground">{segment.text}</p>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeTranscriptDialog}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(addStudentsCourse)} onOpenChange={(open) => (open ? undefined : closeAddStudentsDialog())}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Students</DialogTitle>
            <DialogDescription>
              {addStudentsCourse
                ? `Generate invite links for ${addStudentsCourse.name}${addStudentsCourse.code ? ` (${addStudentsCourse.code})` : ''}.`
                : 'Generate invite links for this course.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label htmlFor="invite-emails">Student emails</Label>
              <Textarea
                id="invite-emails"
                value={inviteEmailsInput}
                onChange={(event) => setInviteEmailsInput(event.target.value)}
                placeholder={'student1@university.edu\nstudent2@university.edu'}
                rows={6}
                disabled={isGeneratingInvites}
              />
              <p className="text-xs text-muted-foreground">
                Paste one email per line or separate by comma. {parsedInviteEmails.length} unique email
                {parsedInviteEmails.length === 1 ? '' : 's'} detected.
              </p>
            </div>

            {generatedInviteResults.length > 0 && (
              <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Generated invite results</p>
                  <Button type="button" size="sm" variant="outline" onClick={handleCopyAllInviteLinks}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy All Links
                  </Button>
                </div>

                {inviteExpiresAt && (
                  <p className="text-xs text-muted-foreground">
                    Expiry: {new Date(inviteExpiresAt).toLocaleString()}
                  </p>
                )}

                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {generatedInviteResults.map((result) => (
                    <div key={`${result.email}-${result.status}-${result.inviteCode ?? 'none'}`} className="rounded-md border border-border bg-background p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-medium">{result.email}</p>
                        <Badge variant={inviteStatusVariant(result.status)}>{inviteStatusLabel(result.status)}</Badge>
                      </div>

                      {result.inviteLink && (
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input value={result.inviteLink} readOnly className="font-mono text-xs" />
                          <Button type="button" size="sm" variant="outline" onClick={() => void copyText(result.inviteLink)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeAddStudentsDialog} disabled={isGeneratingInvites}>
              Close
            </Button>
            <Button type="button" onClick={() => void handleGenerateInvites()} disabled={isGeneratingInvites || parsedInviteEmails.length === 0}>
              {isGeneratingInvites ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate Invite Codes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingFileNameMaterial)} onOpenChange={(open) => (open ? undefined : closeEditFileNameDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Filename</DialogTitle>
            <DialogDescription>
              Update the display name used for this material in the dashboard.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="edit-material-filename">Filename</Label>
            <Input
              id="edit-material-filename"
              value={editingFileNameValue}
              onChange={(event) => setEditingFileNameValue(event.target.value)}
              disabled={isUpdatingFileName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleUpdateFileName();
                }
              }}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEditFileNameDialog} disabled={isUpdatingFileName}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleUpdateFileName()} disabled={isUpdatingFileName}>
              {isUpdatingFileName ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Filename'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="container py-8">
        <div className="mb-6 flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Document Details</h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Manage course documents for RAG. Only enrolled students and course staff can access uploaded files.
            </p>
          </div>
        </div>

        <Tabs defaultValue="add-document" className="space-y-6">
          <TabsList className="h-auto bg-transparent p-0 text-sm">
            <TabsTrigger
              value="overview"
              className="rounded-none border-b-2 border-transparent px-4 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Courses Overview
            </TabsTrigger>
            <TabsTrigger
              value="add-document"
              className="rounded-none border-b-2 border-transparent px-4 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              + Add Document
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Course Setup</CardTitle>
                <CardDescription>Create a course before uploading documents.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="course-name">Course Name</Label>
                  <Input
                    id="course-name"
                    value={newCourseName}
                    onChange={(event) => setNewCourseName(event.target.value)}
                    placeholder="e.g. Intro to ML"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="course-code">Course Code (optional)</Label>
                  <Input
                    id="course-code"
                    value={newCourseCode}
                    onChange={(event) => setNewCourseCode(event.target.value)}
                    placeholder="e.g. CS101"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="course-description">Description (optional)</Label>
                  <Input
                    id="course-description"
                    value={newCourseDescription}
                    onChange={(event) => setNewCourseDescription(event.target.value)}
                    placeholder="Short description"
                  />
                </div>

                <div className="md:col-span-3">
                  <Button onClick={handleCreateCourse} disabled={isCreatingCourse} className="gap-2">
                    {isCreatingCourse && <Loader2 className="h-4 w-4 animate-spin" />}
                    Create Course
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Created Courses</CardTitle>
                <CardDescription>All courses currently available for document uploads.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Course Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Course ID</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingCourses ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading courses...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : courses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                          No courses created yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      courses.map((course) => (
                        <TableRow key={course.id}>
                          <TableCell className="font-medium">{course.name}</TableCell>
                          <TableCell>{course.code || '-'}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{course.id}</TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <Button type="button" size="sm" variant="outline" onClick={() => setAddStudentsCourse(course)}>
                                Add Students
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Academic Terms</CardTitle>
                <CardDescription>
                  The active term is used for retrieval automatically. Assign upload files to the right term.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {profile?.role === 'admin' && (
                  <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-4">
                    <div className="space-y-2">
                      <Label htmlFor="term-semester">Semester</Label>
                      <Select value={newTermSemester} onValueChange={(value) => setNewTermSemester(value as '1' | '2')}>
                        <SelectTrigger id="term-semester">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Semester 1</SelectItem>
                          <SelectItem value="2">Semester 2</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="term-ay-start">AY Start Year</Label>
                      <Input
                        id="term-ay-start"
                        inputMode="numeric"
                        value={newTermAyStart}
                        onChange={(event) => setNewTermAyStart(event.target.value)}
                        placeholder="2026"
                      />
                    </div>

                    <div className="sm:col-span-2 flex items-end">
                      <Button onClick={handleCreateAcademicTerm} disabled={isCreatingTerm} className="gap-2">
                        {isCreatingTerm && <Loader2 className="h-4 w-4 animate-spin" />}
                        Create Academic Term
                      </Button>
                    </div>
                  </div>
                )}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Term</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingTerms ? (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading academic terms...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : academicTerms.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                          No academic terms configured.
                        </TableCell>
                      </TableRow>
                    ) : (
                      academicTerms.map((term) => (
                        <TableRow key={term.id}>
                          <TableCell className="font-medium">{term.label}</TableCell>
                          <TableCell>
                            {term.is_active ? (
                              <Badge variant="default">Active</Badge>
                            ) : (
                              <Badge variant="outline">Inactive</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              {profile?.role === 'admin' ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={term.is_active ? 'secondary' : 'outline'}
                                  disabled={term.is_active || activatingTermId === term.id}
                                  onClick={() => void handleSetActiveTerm(term.id)}
                                >
                                  {activatingTermId === term.id ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      Activating...
                                    </>
                                  ) : term.is_active ? (
                                    'Active'
                                  ) : (
                                    'Set Active'
                                  )}
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">Admin only</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="add-document" className="mt-0 space-y-5">
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="grid gap-4 rounded-lg border border-border bg-muted/20 p-4 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="upload-course-select">Course this document belongs to</Label>
                    <Select value={uploadCourseId} onValueChange={setUploadCourseId} disabled={isUploading}>
                      <SelectTrigger id="upload-course-select">
                        <SelectValue placeholder="Select course for this upload" />
                      </SelectTrigger>
                      <SelectContent>
                        {courses.map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.name} {course.code ? `(${course.code})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      You must select a course before choosing files.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="upload-term-select">Academic term</Label>
                    <Select value={uploadAcademicTermId} onValueChange={setUploadAcademicTermId} disabled={isUploading || isLoadingTerms}>
                      <SelectTrigger id="upload-term-select">
                        <SelectValue placeholder={isLoadingTerms ? 'Loading terms...' : 'Select academic term'} />
                      </SelectTrigger>
                      <SelectContent>
                        {academicTerms.map((term) => (
                          <SelectItem key={term.id} value={term.id}>
                            {term.label} {term.is_active ? '(Active)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      The active term is used in retrieval. You can still upload future-term documents now.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Accessibility</Label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        variant={uploadAccessScope === 'course' ? 'default' : 'outline'}
                        className="justify-start gap-2"
                        onClick={() => setUploadAccessScope('course')}
                        disabled={isUploading}
                      >
                        <Users2 className="h-4 w-4" />
                        Course only
                      </Button>
                      <Button
                        type="button"
                        variant={uploadAccessScope === 'private' ? 'default' : 'outline'}
                        className="justify-start gap-2"
                        onClick={() => setUploadAccessScope('private')}
                        disabled={isUploading}
                      >
                        <Lock className="h-4 w-4" />
                        Private
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Private means only the uploader account can access the file.
                    </p>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_FILE_TYPES}
                  className="hidden"
                  onChange={handleFileInputChange}
                  disabled={isUploading || !isUploadSetupComplete}
                />

                <div
                  role={pendingFiles.length === 0 ? 'button' : undefined}
                  tabIndex={pendingFiles.length === 0 ? 0 : -1}
                  aria-disabled={!isUploadSetupComplete || isUploading}
                  onClick={pendingFiles.length === 0 ? handleOpenFilePicker : undefined}
                  onKeyDown={(event) => {
                    if (pendingFiles.length === 0 && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      handleOpenFilePicker();
                    }
                  }}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    'rounded-lg border-2 border-dashed p-6 transition-colors sm:p-8',
                    isDragActive ? 'border-primary bg-primary/5' : 'border-border bg-muted/20',
                    !isUploadSetupComplete && 'border-muted-foreground/30 bg-muted/10',
                    isUploading && 'pointer-events-none opacity-70'
                  )}
                >
                  {pendingFiles.length > 0 ? (
                    <>
                      <div className="flex flex-col gap-3 text-left sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {pendingFiles.length} material{pendingFiles.length === 1 ? '' : 's'} ready
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Course: {courseLabelById[uploadCourseId] || 'Unknown'} • Access:{' '}
                            {uploadAccessScope ? accessScopeLabel(uploadAccessScope) : 'Not selected'} • Term:{' '}
                            {termLabelById[uploadAcademicTermId] || 'Not selected'}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Drag and drop more files here, or use Add Document.
                          </p>
                        </div>

                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenFilePicker();
                          }}
                          disabled={isUploading}
                        >
                          Add Document
                        </Button>
                      </div>

                      <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1 text-left">
                        {pendingFiles.map((candidate) => {
                          const fileKey = getPendingFileKey(candidate);
                          return (
                            <div
                              key={fileKey}
                              className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-foreground">{candidate.name}</p>
                                <p className="text-xs text-muted-foreground">{formatBytes(candidate.size)}</p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removePendingFile(fileKey);
                                }}
                                disabled={isUploading}
                                aria-label={`Remove ${candidate.name}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>

                      {isUploading && currentUploadFileName && (
                        <div className="mt-4 space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-left">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium text-foreground">{currentUploadFileName}</p>
                            <div className="flex shrink-0 items-center gap-2">
                              {currentUploadFileSize != null && (
                                <span className="text-xs text-muted-foreground">{formatBytes(currentUploadFileSize)}</span>
                              )}
                              {currentUploadIndex && (
                                <Badge variant="secondary" className="text-xs">
                                  {currentUploadIndex.current} / {currentUploadIndex.total}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-300"
                                style={{ width: `${currentUploadProgress ?? 0}%` }}
                              />
                            </div>
                            <span className="w-8 text-right text-xs font-medium text-muted-foreground">
                              {currentUploadProgress != null ? `${Math.round(currentUploadProgress)}%` : ''}
                            </span>
                          </div>
                          {currentUploadStatusText && (
                            <p className="text-xs text-muted-foreground">{currentUploadStatusText}</p>
                          )}
                        </div>
                      )}

                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCancelUpload();
                          }}
                        >
                          {isUploading ? 'Cancel Upload' : 'Clear List'}
                        </Button>
                        <Button
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleUpload();
                          }}
                          disabled={!uploadCourseId || !uploadAccessScope || !uploadAcademicTermId || isUploading || pendingFiles.length === 0}
                        >
                          {isUploading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            `Upload Selected (${pendingFiles.length})`
                          )}
                        </Button>
                      </div>
                    </>
                  ) : isUploadSetupComplete ? (
                    <>
                      <div className="text-center">
                        <UploadCloud className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Drop your course materials here, or <span className="font-medium text-primary underline">click to browse</span>
                        </p>
                      </div>
                      <div className="mt-4 grid gap-3 text-left sm:grid-cols-3">
                        {uploadChecklistItems.map((item) => (
                          <div
                            key={item.id}
                            className={cn(
                              'rounded-lg border px-4 py-3',
                              item.isDone ? 'border-emerald-200 bg-emerald-50/80' : 'border-border bg-background/70'
                            )}
                          >
                            <div className="flex items-start gap-3">
                              {item.isDone ? (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                              ) : (
                                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">{item.label}</p>
                                <p className="text-xs text-muted-foreground">{item.detail}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-center">
                        <UploadCloud className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                        <p className="text-sm font-medium text-foreground">Complete these steps before adding files</p>
                      </div>
                      <div className="mt-4 grid gap-3 text-left sm:grid-cols-3">
                        {uploadChecklistItems.map((item) => (
                          <div
                            key={item.id}
                            className={cn(
                              'rounded-lg border px-4 py-3',
                              item.isDone ? 'border-emerald-200 bg-emerald-50/80' : 'border-border bg-background/70'
                            )}
                          >
                            <div className="flex items-start gap-3">
                              {item.isDone ? (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                              ) : (
                                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">{item.label}</p>
                                <p className="text-xs text-muted-foreground">{item.detail}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-sm font-medium text-foreground">What can be uploaded?</p>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <li>PDF, DOC, DOCX, PPTX, PNG, JPG, JPEG, WEBP, and GIF files.</li>
                    <li>PDF, DOC, and image files must be {documentLimitMb}MB or smaller.</li>
                    <li>MP4 and WebM video files are supported (audio is extracted and transcribed with timestamps).</li>
                    <li>DOCX and PPTX files are extracted after upload.</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Uploaded Materials</CardTitle>
                <CardDescription>
                  Use the search tools below to quickly search for your materials
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search uploaded materials"
                      className="pl-9"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setShowFilters((current) => !current)}>
                      <Filter className="mr-2 h-4 w-4" />
                      Filters
                    </Button>
                  </div>
                </div>

                {showFilters && (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <Select value={courseFilter} onValueChange={setCourseFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="All Courses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Courses</SelectItem>
                        {courses.map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.name} {course.code ? `(${course.code})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={accessFilter} onValueChange={setAccessFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Access" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Access</SelectItem>
                        <SelectItem value="course">Course only</SelectItem>
                        <SelectItem value="public">Everyone</SelectItem>
                        <SelectItem value="private">Private</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={academicTermFilter} onValueChange={setAcademicTermFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Academic Terms" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Academic Terms</SelectItem>
                        {academicTerms.map((term) => (
                          <SelectItem key={term.id} value={term.id}>
                            {term.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={dateFilter} onValueChange={setDateFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Document Date" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Document Date</SelectItem>
                        <SelectItem value="last_7_days">Last 7 days</SelectItem>
                        <SelectItem value="last_30_days">Last 30 days</SelectItem>
                        <SelectItem value="this_year">This year</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Status</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="processing">Processing</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document Name</TableHead>
                      <TableHead>Academic Term</TableHead>
                      <TableHead>Course</TableHead>
                      <TableHead>Access</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead className="sticky right-0 z-20 w-14 border-l bg-inherit px-2 text-right">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingMaterials ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading documents...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : filteredMaterials.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <div className="flex flex-col items-center justify-center py-6 text-center text-sm text-muted-foreground">
                            <FileText className="mb-2 h-5 w-5" />
                            No materials match your filters.
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMaterials.map((material) => (
                        <TableRow key={material.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {material.file_type === 'video' ? <Video className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                              <div className="min-w-0">
                                <p className="truncate">{material.file_name}</p>
                                {material.file_type === 'video' && formatDuration(material.duration_ms) ? (
                                  <p className="text-xs text-muted-foreground">{formatDuration(material.duration_ms)}</p>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{material.academic_term_id ? termLabelById[material.academic_term_id] || 'Unknown term' : '-'}</TableCell>
                          <TableCell>{courseLabelById[material.course_id] || 'Unknown course'}</TableCell>
                          <TableCell>{renderAccessBadge(material.access_scope)}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {renderStatusBadge(material)}
                              {material.processing_status === 'processing' ? (
                                <div className="max-w-56 space-y-1">
                                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                    {/* <span>{getProcessingStageLabel(material)}</span> */}
                                    {/* <span>{material.processing_progress ?? 0}%</span> */}
                                  </div>
                                  <Progress value={material.processing_progress ?? 0} className="h-2" />
                                </div>
                              ) : material.processing_status === 'failed' && material.processing_error ? (
                                <p className="max-w-56 text-xs text-destructive">{material.processing_error}</p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>{formatBytes(material.file_size)}</TableCell>
                          <TableCell className="sticky right-0 z-10 border-l bg-inherit px-2">
                            <div className="flex justify-end">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" aria-label={`Open actions for ${material.file_name}`}>
                                    <Ellipsis className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  {material.file_type === 'video' ? (
                                    <DropdownMenuItem
                                      disabled={material.processing_status !== 'completed'}
                                      onClick={() => handleOpenTranscript(material)}
                                    >
                                      <FileText className="mr-2 h-4 w-4" />
                                      View transcript
                                    </DropdownMenuItem>
                                  ) : null}
                                  <DropdownMenuItem onClick={() => openEditFileNameDialog(material)}>
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit filename
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => handleDeleteMaterial(material)}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
