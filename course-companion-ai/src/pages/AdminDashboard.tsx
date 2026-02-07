import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Upload, Loader2, CheckCircle2, Clock, AlertCircle, FileText } from 'lucide-react';
import { toast } from 'sonner';

type Course = {
  id: string;
  name: string;
  code: string | null;
};

type Material = {
  id: string;
  course_id: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  topic: string | null;
  week_number: number | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
};

const SUPPORTED_EXTENSIONS = new Set([
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

const getFileType = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (['vtt', 'srt'].includes(ext)) return 'transcript';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides';
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

export default function AdminDashboard() {
  const { profile } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [topic, setTopic] = useState('');
  const [weekNumber, setWeekNumber] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);

  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');
  const [newCourseDescription, setNewCourseDescription] = useState('');
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);

  const fetchCourses = async () => {
    setIsLoadingCourses(true);
    const { data, error } = await supabase
      .from('courses')
      .select('id, name, code')
      .order('name');

    if (error) {
      toast.error('Failed to load courses');
      setIsLoadingCourses(false);
      return;
    }

    const nextCourses = (data || []) as Course[];
    setCourses(nextCourses);
    if (!selectedCourseId && nextCourses.length > 0) {
      setSelectedCourseId(nextCourses[0].id);
    }
    setIsLoadingCourses(false);
  };

  const fetchMaterials = async (courseId?: string) => {
    setIsLoadingMaterials(true);
    let query = supabase
      .from('materials')
      .select('id, course_id, file_name, file_type, file_size, topic, week_number, processing_status, created_at')
      .order('created_at', { ascending: false })
      .limit(25);

    if (courseId) {
      query = query.eq('course_id', courseId);
    }

    const { data, error } = await query;
    if (error) {
      toast.error('Failed to load materials');
      setIsLoadingMaterials(false);
      return;
    }

    setMaterials((data || []) as Material[]);
    setIsLoadingMaterials(false);
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  useEffect(() => {
    if (selectedCourseId) {
      fetchMaterials(selectedCourseId);
    }
  }, [selectedCourseId]);

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

    const created = data as Course;
    setCourses(prev => [created, ...prev]);
    setSelectedCourseId(created.id);
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
    if (!selectedCourseId) {
      toast.error('Select a course first');
      return;
    }
    if (!file) {
      toast.error('Choose a file to upload');
      return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const isTextLike = file.type.startsWith('text/') || SUPPORTED_EXTENSIONS.has(extension);
    if (!isTextLike) {
      toast.error('Only text-based files are supported for ingestion right now');
      return;
    }

    setIsUploading(true);

    try {
      const filePath = `${selectedCourseId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('course-materials')
        .upload(filePath, file, { upsert: false });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: material, error: insertError } = await supabase
        .from('materials')
        .insert({
          course_id: selectedCourseId,
          file_name: file.name,
          file_path: filePath,
          file_type: getFileType(file.name),
          file_size: file.size,
          topic: topic.trim() || null,
          week_number: weekNumber ? Number(weekNumber) : null,
          is_public: isPublic,
          processing_status: 'processing',
          uploaded_by: profile.id,
        })
        .select('id')
        .single();

      if (insertError || !material) {
        throw new Error(insertError?.message || 'Failed to create material record');
      }

      const text = await file.text();
      const { error: ingestError } = await supabase.functions.invoke('ingest-material', {
        body: {
          materialId: material.id,
          text,
        },
      });

      if (ingestError) {
        throw new Error(ingestError.message || 'Failed to ingest material');
      }

      toast.success('Material uploaded and indexed');
      setFile(null);
      setTopic('');
      setWeekNumber('');
      setIsPublic(false);
      await fetchMaterials(selectedCourseId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusBadge = (status: Material['processing_status']) => {
    const variants: Record<Material['processing_status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
      completed: 'default',
      processing: 'secondary',
      pending: 'outline',
      failed: 'destructive',
    };

    const icon = {
      completed: <CheckCircle2 className="h-4 w-4 text-success" />,
      processing: <Loader2 className="h-4 w-4 animate-spin text-warning" />,
      pending: <Clock className="h-4 w-4 text-muted-foreground" />,
      failed: <AlertCircle className="h-4 w-4 text-destructive" />,
    }[status];

    return (
      <Badge variant={variants[status]} className="capitalize">
        {icon}
        <span className="ml-1">{status}</span>
      </Badge>
    );
  };

  return (
    <MainLayout showFooter={false}>
      <div className="container py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Upload course materials and push them into the RAG pipeline
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Upload Materials</CardTitle>
              <CardDescription>
                Supported formats: text, markdown, CSV, JSON, and code files
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Course</Label>
                  {isLoadingCourses ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading courses...
                    </div>
                  ) : courses.length > 0 ? (
                    <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a course" />
                      </SelectTrigger>
                      <SelectContent>
                        {courses.map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.name} {course.code ? `(${course.code})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No courses found. Create one to upload materials.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="material-file">File</Label>
                  <Input
                    id="material-file"
                    type="file"
                    accept=".txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.java,.go,.rb,.rs,.c,.cpp,.html,.css,.sql"
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                    disabled={isUploading}
                  />
                  {file && (
                    <p className="text-xs text-muted-foreground">
                      {file.name} • {formatBytes(file.size)}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="material-topic">Topic (optional)</Label>
                  <Input
                    id="material-topic"
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                    placeholder="e.g. Regression"
                    disabled={isUploading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="material-week">Week (optional)</Label>
                  <Input
                    id="material-week"
                    type="number"
                    min="1"
                    value={weekNumber}
                    onChange={(event) => setWeekNumber(event.target.value)}
                    placeholder="e.g. 3"
                    disabled={isUploading}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div className="space-y-1">
                  <Label htmlFor="material-public" className="text-sm font-medium">
                    Public access
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Allow all accounts to access this document.
                  </p>
                </div>
                <Switch
                  id="material-public"
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                  disabled={isUploading}
                />
              </div>

              <Button
                className="gap-2"
                onClick={handleUpload}
                disabled={isUploading || !selectedCourseId || !file}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Upload & Index
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Create Course</CardTitle>
              <CardDescription>Set up a course before uploading materials.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleCreateCourse}
                disabled={isCreatingCourse}
              >
                {isCreatingCourse ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Course'
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>Recent Materials</CardTitle>
              <CardDescription>Latest uploads for the selected course</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoadingMaterials ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading materials...
                </div>
              ) : materials.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <FileText className="mb-3 h-10 w-10 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No materials uploaded yet.</p>
                </div>
              ) : (
                materials.map((material) => (
                  <div
                    key={material.id}
                    className="flex flex-col gap-3 rounded-lg border border-border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{material.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {material.file_type} • {formatBytes(material.file_size)} •{' '}
                        {new Date(material.created_at).toLocaleDateString()}
                      </p>
                      {(material.topic || material.week_number) && (
                        <p className="text-xs text-muted-foreground">
                          {material.topic ? `Topic: ${material.topic}` : ''}
                          {material.topic && material.week_number ? ' • ' : ''}
                          {material.week_number ? `Week ${material.week_number}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(material.processing_status)}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
