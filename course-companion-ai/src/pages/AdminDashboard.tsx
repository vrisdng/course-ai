import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Ellipsis,
  Eye,
  FileText,
  Filter,
  Globe2,
  Loader2,
  Lock,
  Search,
  Trash2,
  UploadCloud,
  Users2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const ACCEPTED_FILE_TYPES =
  '.txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.java,.go,.rb,.rs,.c,.cpp,.html,.css,.sql,.pdf,.doc,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif';

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
]);

const TEXT_EXTENSIONS = new Set([
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
]);

type Course = {
  id: string;
  name: string;
  code: string | null;
};

type MaterialStatus = 'pending' | 'processing' | 'completed' | 'failed';
type AccessScope = 'course' | 'public' | 'private';

type Material = {
  id: string;
  course_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number | null;
  topic: string | null;
  week_number: number | null;
  processing_status: MaterialStatus;
  access_scope: AccessScope;
  created_at: string;
};

const getFileType = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (['vtt', 'srt'].includes(ext)) return 'transcript';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides';
  if (['doc', 'docx'].includes(ext)) return 'notes';
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

const isFileSupported = (candidate: File) => {
  const extension = candidate.name.split('.').pop()?.toLowerCase() || '';
  return candidate.type.startsWith('text/') || SUPPORTED_EXTENSIONS.has(extension);
};

export default function AdminDashboard() {
  const { profile } = useAuth();

  const [courses, setCourses] = useState<Course[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);

  const [uploadCourseId, setUploadCourseId] = useState<string>('');
  const [uploadAccessScope, setUploadAccessScope] = useState<AccessScope | ''>('');
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');
  const [newCourseDescription, setNewCourseDescription] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [currentUploadFileName, setCurrentUploadFileName] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);

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

  const fetchMaterials = useCallback(async () => {
    setIsLoadingMaterials(true);

    const { data, error } = await supabase
      .from('materials')
      .select('id, course_id, file_name, file_path, file_type, file_size, topic, week_number, processing_status, access_scope, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      const fallback = await supabase
        .from('materials')
        .select('id, course_id, file_name, file_path, file_type, file_size, topic, week_number, processing_status, is_public, created_at')
        .order('created_at', { ascending: false })
        .limit(200);

      if (fallback.error) {
        toast.error('Failed to load materials');
        setIsLoadingMaterials(false);
        return;
      }

      const fallbackMaterials = (fallback.data || []).map((material: any) => ({
        ...material,
        access_scope: material.is_public ? 'public' : 'course',
      })) as Material[];

      setMaterials(fallbackMaterials);
      setIsLoadingMaterials(false);
      return;
    }

    setMaterials((data || []) as Material[]);
    setIsLoadingMaterials(false);
  }, []);

  useEffect(() => {
    void fetchCourses();
    void fetchMaterials();
  }, [fetchCourses, fetchMaterials]);

  const courseLabelById = useMemo(() => {
    return courses.reduce<Record<string, string>>((acc, course) => {
      acc[course.id] = `${course.name}${course.code ? ` (${course.code})` : ''}`;
      return acc;
    }, {});
  }, [courses]);

  const filteredMaterials = useMemo(() => {
    const now = new Date();

    return materials.filter((material) => {
      const haystack = `${material.file_name} ${material.topic || ''}`.toLowerCase();
      const searchMatch = !searchQuery.trim() || haystack.includes(searchQuery.trim().toLowerCase());
      const courseMatch = courseFilter === 'all' || material.course_id === courseFilter;
      const typeMatch = typeFilter === 'all' || material.file_type === typeFilter;
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

      return searchMatch && courseMatch && typeMatch && statusMatch && accessMatch && dateMatch;
    });
  }, [accessFilter, courseFilter, dateFilter, materials, searchQuery, statusFilter, typeFilter]);

  const getPendingFileKey = (candidate: File) =>
    `${candidate.name}-${candidate.size}-${candidate.lastModified}`;

  const resetUploadSelection = () => {
    setPendingFiles([]);
    setCurrentUploadFileName(null);
    setIsDragActive(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const addPendingFiles = (candidates: File[]) => {
    if (!candidates.length) {
      return;
    }

    if (!uploadCourseId) {
      toast.error('Select the course for this document first');
      return;
    }

    const unsupported: string[] = [];
    let addedCount = 0;

    setPendingFiles((previous) => {
      const keys = new Set(previous.map((item) => getPendingFileKey(item)));
      const next = [...previous];

      for (const candidate of candidates) {
        if (!isFileSupported(candidate)) {
          unsupported.push(candidate.name);
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

    if (addedCount === 0 && unsupported.length === 0) {
      toast.info('These files are already in your review list.');
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    addPendingFiles(Array.from(event.target.files || []));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isUploading && uploadCourseId) {
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

    if (!uploadCourseId) {
      toast.error('Select the course for this document first');
      return;
    }

    addPendingFiles(Array.from(event.dataTransfer.files || []));
  };

  useEffect(() => {
    setPendingFiles([]);
    setCurrentUploadFileName(null);
    setIsDragActive(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [uploadCourseId]);

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

  const uploadSingleFile = async (
    targetFile: File,
    courseId: string,
    accessScope: AccessScope,
    uploaderId: string
  ) => {
    const extension = targetFile.name.split('.').pop()?.toLowerCase() || '';
    const isSupported = targetFile.type.startsWith('text/') || SUPPORTED_EXTENSIONS.has(extension);
    if (!isSupported) {
      throw new Error('Unsupported file type. Please upload a supported format.');
    }

    const filePath = `${courseId}/${crypto.randomUUID()}-${targetFile.name}`;
    const { error: uploadError } = await supabaseAbortable.storage
      .from('course-materials')
      .upload(filePath, targetFile, { upsert: false });

    if (cancelUploadRef.current) {
      throw new Error('Upload cancelled');
    }

    if (uploadError) {
      throw new Error(uploadError.message);
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
        uploaded_by: uploaderId,
      })
      .select('id')
      .single();

    if (insertError || !material) {
      if (insertError?.message?.toLowerCase().includes('access_scope')) {
        throw new Error('Database is missing access scope support. Run the latest migrations.');
      }
      throw new Error(insertError?.message || 'Failed to create material record');
    }

    if (cancelUploadRef.current) {
      throw new Error('Upload cancelled');
    }

    const isTextLike = targetFile.type.startsWith('text/') || TEXT_EXTENSIONS.has(extension);
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
      return;
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
    if (pendingFiles.length === 0) {
      toast.error('Choose at least one file to upload');
      return;
    }

    const queue = [...pendingFiles];
    const courseId = uploadCourseId;
    const accessScope = uploadAccessScope;
    const uploaderId = profile.id;
    const failedFiles: File[] = [];
    let successCount = 0;
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
        abortControllerRef.current = new AbortController();

        try {
          await uploadSingleFile(targetFile, courseId, accessScope, uploaderId);
          successCount += 1;
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

      if (successCount > 0) {
        await fetchMaterials();
      }

      if (successCount > 0 && failedFiles.length === 0) {
        toast.success(`${successCount} document${successCount === 1 ? '' : 's'} uploaded and indexed`);
      } else if (successCount > 0) {
        toast.success(`${successCount} document${successCount === 1 ? '' : 's'} uploaded`);
      }

      if (failedFiles.length > 0) {
        toast.error(`${failedFiles.length} document${failedFiles.length === 1 ? '' : 's'} failed. Remove or retry.`);
      }
    } finally {
      setIsUploading(false);
      cancelUploadRef.current = false;
      abortControllerRef.current = null;
      setCurrentUploadFileName(null);
    }
  };

  const accessScopeLabel = (scope: AccessScope) => {
    if (scope === 'course') return 'Course only';
    if (scope === 'public') return 'Everyone';
    return 'Private';
  };

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

  const renderStatusBadge = (status: MaterialStatus) => {
    const icon = {
      completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
      processing: <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />,
      pending: <Clock className="h-3.5 w-3.5 text-slate-500" />,
      failed: <AlertCircle className="h-3.5 w-3.5 text-red-500" />,
    }[status];

    const variant: Record<MaterialStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      processing: 'secondary',
      pending: 'outline',
      failed: 'destructive',
    };

    return (
      <Badge variant={variant[status]} className="capitalize gap-1">
        {icon}
        {status}
      </Badge>
    );
  };

  const uniqueFileTypes = useMemo(() => {
    return Array.from(new Set(materials.map((material) => material.file_type))).sort();
  }, [materials]);

  return (
    <MainLayout showFooter={false}>
      <div className="container py-8">
        <div className="mb-6 flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Document Details</h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Manage course documents for RAG. Only enrolled students and course staff can access uploaded files.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">Help</Button>
            <Button variant="outline" size="icon" aria-label="More options">
              <Ellipsis className="h-4 w-4" />
            </Button>
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingCourses ? (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading courses...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : courses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                          No courses created yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      courses.map((course) => (
                        <TableRow key={course.id}>
                          <TableCell className="font-medium">{course.name}</TableCell>
                          <TableCell>{course.code || '-'}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{course.id}</TableCell>
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
                <div className="flex flex-col gap-3 lg:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search for document"
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

                <div className="grid gap-4 rounded-lg border border-border bg-muted/20 p-4 lg:grid-cols-2">
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
                    <Label>Who can access this document?</Label>
                    <div className="grid gap-2 sm:grid-cols-3">
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
                        variant={uploadAccessScope === 'public' ? 'default' : 'outline'}
                        className="justify-start gap-2"
                        onClick={() => setUploadAccessScope('public')}
                        disabled={isUploading}
                      >
                        <Globe2 className="h-4 w-4" />
                        Everyone
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

                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Document Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Document Type</SelectItem>
                        {uniqueFileTypes.map((fileType) => (
                          <SelectItem key={fileType} value={fileType}>
                            {fileType}
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

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_FILE_TYPES}
                  className="hidden"
                  onChange={handleFileInputChange}
                  disabled={isUploading || !uploadCourseId}
                />

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!uploadCourseId && !isUploading) {
                      toast.error('Select the course for this document first');
                      return;
                    }
                    if (!isUploading && uploadCourseId) {
                      fileInputRef.current?.click();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!uploadCourseId && !isUploading && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      toast.error('Select the course for this document first');
                      return;
                    }
                    if (!isUploading && uploadCourseId && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    'rounded-lg border-2 border-dashed p-10 text-center transition-colors',
                    isDragActive ? 'border-primary bg-primary/5' : 'border-border bg-muted/20',
                    !uploadCourseId && 'border-muted-foreground/30 bg-muted/10',
                    isUploading && 'pointer-events-none opacity-70'
                  )}
                >
                  <UploadCloud className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  {uploadCourseId ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Drop your documents here, or <span className="font-medium text-primary underline">click to browse</span>
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Files are added to a review list first. Supported: PDF, DOCX, PPTX, images, markdown, code, CSV, JSON, and plain text.
                      </p>
                      {isUploading && currentUploadFileName && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Uploading: {currentUploadFileName}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-foreground">Select a course first</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Then you can choose documents to upload.
                      </p>
                    </>
                  )}
                </div>

                {pendingFiles.length > 0 && (
                  <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm font-medium text-foreground">
                        {pendingFiles.length} document{pendingFiles.length === 1 ? '' : 's'} ready
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Course: {courseLabelById[uploadCourseId] || 'Unknown'} • Access:{' '}
                        {uploadAccessScope ? accessScopeLabel(uploadAccessScope) : 'Not selected'}
                      </p>
                    </div>

                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
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
                              onClick={() => removePendingFile(fileKey)}
                              disabled={isUploading}
                              aria-label={`Remove ${candidate.name}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                      <Button size="sm" variant="outline" onClick={handleCancelUpload}>
                        {isUploading ? 'Cancel Upload' : 'Clear List'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleUpload}
                        disabled={!uploadCourseId || !uploadAccessScope || isUploading || pendingFiles.length === 0}
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
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Uploaded Documents</CardTitle>
                <CardDescription>
                  {isLoadingCourses ? 'Loading courses...' : `${filteredMaterials.length} document${filteredMaterials.length === 1 ? '' : 's'} found`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document Name</TableHead>
                      <TableHead>Document Type</TableHead>
                      <TableHead>Document Date</TableHead>
                      <TableHead>Course</TableHead>
                      <TableHead>Access</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead className="text-right">Operation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingMaterials ? (
                      <TableRow>
                        <TableCell colSpan={8}>
                          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading documents...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : filteredMaterials.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8}>
                          <div className="flex flex-col items-center justify-center py-6 text-center text-sm text-muted-foreground">
                            <FileText className="mb-2 h-5 w-5" />
                            No documents match your filters.
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMaterials.map((material) => (
                        <TableRow key={material.id}>
                          <TableCell className="font-medium">{material.file_name}</TableCell>
                          <TableCell className="capitalize">{material.file_type}</TableCell>
                          <TableCell>{new Date(material.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>{courseLabelById[material.course_id] || 'Unknown course'}</TableCell>
                          <TableCell>{renderAccessBadge(material.access_scope)}</TableCell>
                          <TableCell>{renderStatusBadge(material.processing_status)}</TableCell>
                          <TableCell>{formatBytes(material.file_size)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="icon" onClick={() => handleOpenMaterial(material)} aria-label="Open document">
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleDeleteMaterial(material)}
                                aria-label="Delete document"
                              >
                                <Trash2 className="h-4 w-4" />
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
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
