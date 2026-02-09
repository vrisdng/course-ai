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
  Loader2,
  Search,
  Trash2,
  UploadCloud,
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
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');
  const [newCourseDescription, setNewCourseDescription] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(true);

  const [file, setFile] = useState<File | null>(null);
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
    setUploadCourseId((current) => current || nextCourses[0]?.id || '');
    setIsLoadingCourses(false);
  }, []);

  const fetchMaterials = useCallback(async () => {
    setIsLoadingMaterials(true);

    const { data, error } = await supabase
      .from('materials')
      .select('id, course_id, file_name, file_path, file_type, file_size, topic, week_number, processing_status, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      toast.error('Failed to load materials');
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

      return searchMatch && courseMatch && typeMatch && statusMatch && dateMatch;
    });
  }, [courseFilter, dateFilter, materials, searchQuery, statusFilter, typeFilter]);

  const resetUploadSelection = () => {
    setFile(null);
    setIsDragActive(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const pickFile = (candidate: File | null) => {
    if (!candidate) {
      return;
    }

    if (!isFileSupported(candidate)) {
      toast.error('Unsupported file type. Please upload a supported format.');
      return;
    }

    setFile(candidate);
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    pickFile(event.target.files?.[0] || null);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isUploading) {
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

    pickFile(event.dataTransfer.files?.[0] || null);
  };

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

  const handleUpload = async () => {
    if (!profile) {
      toast.error('Profile not loaded');
      return;
    }
    if (!uploadCourseId) {
      toast.error('Select a course first');
      return;
    }
    if (!file) {
      toast.error('Choose a file to upload');
      return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const isSupported = file.type.startsWith('text/') || SUPPORTED_EXTENSIONS.has(extension);
    if (!isSupported) {
      toast.error('Unsupported file type. Please upload a supported format.');
      return;
    }

    setIsUploading(true);
    cancelUploadRef.current = false;
    abortControllerRef.current = new AbortController();

    try {
      const filePath = `${uploadCourseId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabaseAbortable.storage.from('course-materials').upload(filePath, file, { upsert: false });

      if (cancelUploadRef.current) {
        throw new Error('Upload cancelled');
      }

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: material, error: insertError } = await supabaseAbortable
        .from('materials')
        .insert({
          course_id: uploadCourseId,
          file_name: file.name,
          file_path: filePath,
          file_type: getFileType(file.name),
          file_size: file.size,
          topic: null,
          week_number: null,
          processing_status: 'processing',
          uploaded_by: profile.id,
        })
        .select('id')
        .single();

      if (insertError || !material) {
        throw new Error(insertError?.message || 'Failed to create material record');
      }

      if (cancelUploadRef.current) {
        throw new Error('Upload cancelled');
      }

      const isTextLike = file.type.startsWith('text/') || TEXT_EXTENSIONS.has(extension);
      if (isTextLike) {
        const text = await file.text();
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
      } else {
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
      }

      toast.success('Document uploaded and indexed');
      resetUploadSelection();
      await fetchMaterials();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      const isAborted = abortControllerRef.current?.signal.aborted;

      if (message === 'Upload cancelled' || isAborted) {
        toast.info('Upload cancelled');
      } else {
        toast.error(message);
      }
    } finally {
      setIsUploading(false);
      cancelUploadRef.current = false;
      abortControllerRef.current = null;
    }
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

                {showFilters && (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <Select value={uploadCourseId} onValueChange={setUploadCourseId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Upload Course" />
                      </SelectTrigger>
                      <SelectContent>
                        {courses.map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.name} {course.code ? `(${course.code})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

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
                  accept={ACCEPTED_FILE_TYPES}
                  className="hidden"
                  onChange={handleFileInputChange}
                  disabled={isUploading}
                />

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!file && !isUploading) {
                      fileInputRef.current?.click();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!file && !isUploading && (event.key === 'Enter' || event.key === ' ')) {
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
                    isUploading && 'pointer-events-none opacity-70'
                  )}
                >
                  <UploadCloud className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  {file ? (
                    <>
                      <p className="text-sm font-medium text-foreground">{file.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                        <Button size="sm" onClick={handleUpload} disabled={!uploadCourseId || isUploading}>
                          {isUploading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Uploading
                            </>
                          ) : (
                            'Upload Document'
                          )}
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleCancelUpload}>
                          {isUploading ? 'Cancel Upload' : 'Clear'}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Drop your documents here, or <span className="font-medium text-primary underline">click to browse</span>
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Supports PDF, DOCX, PPTX, images, markdown, code, CSV, JSON, and plain text.
                      </p>
                    </>
                  )}
                </div>
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
                      <TableHead>Status</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead className="text-right">Operation</TableHead>
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
