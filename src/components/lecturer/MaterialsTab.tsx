import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Ellipsis,
  FileText,
  Filter,
  Globe2,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  Users2,
  Video,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatTimestamp as formatClock } from '@/features/student-chat/time';
import { INLINE_GEMINI_MAX_FILE_SIZE_BYTES } from '@/lib/materialUpload';
import { cn, formatBytes } from '@/lib/utils';

import { EditFileNameDialog } from './EditFileNameDialog';
import { LinkedUrlDialog } from './LinkedUrlDialog';
import { TranscriptDialog } from './TranscriptDialog';

import { ACCEPTED_FILE_TYPES, useMaterialUpload } from '@/features/materials/useMaterialUpload';
import { useMaterialActions } from '@/features/materials/useMaterialActions';
import { useMaterialsList } from '@/features/materials/useMaterialsList';
import type { AcademicTerm, AccessScope, Course, Material } from '@/features/materials/types';

function formatDuration(durationMs: number | null | undefined) {
  if (typeof durationMs !== 'number' || durationMs <= 0) {
    return null;
  }

  return formatClock(durationMs);
}

function accessScopeLabel(scope: AccessScope) {
  if (scope === 'course') return 'Course only';
  if (scope === 'public') return 'Everyone';
  return 'Private';
}

function renderAccessBadge(scope: AccessScope) {
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
}

function getProcessingStageLabel(material: Material) {
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
}

function renderStatusBadge(material: Material) {
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
}

interface MaterialsTabProps {
  uploaderId: string | undefined;
  courses: Course[];
  academicTerms: AcademicTerm[];
  isLoadingTerms: boolean;
}

export function MaterialsTab({ uploaderId, courses, academicTerms, isLoadingTerms }: MaterialsTabProps) {
  const [uploadCourseId, setUploadCourseId] = useState<string>('');
  const [uploadAcademicTermId, setUploadAcademicTermId] = useState<string>('');
  const [uploadAccessScope, setUploadAccessScope] = useState<AccessScope | ''>('');

  const list = useMaterialsList();
  const upload = useMaterialUpload({ uploaderId, onUploaded: list.fetchMaterials });
  const actions = useMaterialActions({ onMaterialsChanged: list.fetchMaterials, setMaterials: list.setMaterials });

  const courseLabelById = courses.reduce<Record<string, string>>((acc, course) => {
    acc[course.id] = `${course.name}${course.code ? ` (${course.code})` : ''}`;
    return acc;
  }, {});

  const termLabelById = academicTerms.reduce<Record<string, string>>((acc, term) => {
    acc[term.id] = term.label;
    return acc;
  }, {});

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

  return (
    <>
      <LinkedUrlDialog
        material={actions.linkedUrlMaterial}
        value={actions.linkedUrlValue}
        isSaving={actions.isSavingLinkedUrl}
        onValueChange={actions.setLinkedUrlValue}
        onClose={actions.closeLinkedUrlDialog}
        onSave={() => void actions.handleSaveLinkedUrl()}
      />

      <TranscriptDialog
        material={actions.transcriptMaterial}
        segments={actions.transcriptSegments}
        isLoading={actions.isLoadingTranscript}
        onClose={actions.closeTranscriptDialog}
      />

      <EditFileNameDialog
        material={actions.editingFileNameMaterial}
        value={actions.editingFileNameValue}
        isSaving={actions.isUpdatingFileName}
        onValueChange={actions.setEditingFileNameValue}
        onClose={actions.closeEditFileNameDialog}
        onSave={() => void actions.handleUpdateFileName()}
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 rounded-lg border border-border bg-muted/20 p-4 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="upload-course-select">Course this document belongs to</Label>
              <Select value={uploadCourseId} onValueChange={setUploadCourseId} disabled={upload.isUploading}>
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
              <Select value={uploadAcademicTermId} onValueChange={setUploadAcademicTermId} disabled={upload.isUploading || isLoadingTerms}>
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
                  disabled={upload.isUploading}
                >
                  <Users2 className="h-4 w-4" />
                  Course only
                </Button>
                <Button
                  type="button"
                  variant={uploadAccessScope === 'private' ? 'default' : 'outline'}
                  className="justify-start gap-2"
                  onClick={() => setUploadAccessScope('private')}
                  disabled={upload.isUploading}
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
            ref={upload.fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_FILE_TYPES}
            className="hidden"
            onChange={(event) => upload.handleFileInputChange(event, uploadSetupError)}
            disabled={upload.isUploading || !isUploadSetupComplete}
          />

          <div
            role={upload.pendingFiles.length === 0 ? 'button' : undefined}
            tabIndex={upload.pendingFiles.length === 0 ? 0 : -1}
            aria-disabled={!isUploadSetupComplete || upload.isUploading}
            onClick={upload.pendingFiles.length === 0 ? () => upload.handleOpenFilePicker(uploadSetupError) : undefined}
            onKeyDown={(event) => {
              if (upload.pendingFiles.length === 0 && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                upload.handleOpenFilePicker(uploadSetupError);
              }
            }}
            onDragOver={(event) => upload.handleDragOver(event, uploadSetupError)}
            onDragLeave={upload.handleDragLeave}
            onDrop={(event) => upload.handleDrop(event, uploadSetupError)}
            className={cn(
              'rounded-lg border-2 border-dashed p-6 transition-colors sm:p-8',
              upload.isDragActive ? 'border-primary bg-primary/5' : 'border-border bg-muted/20',
              !isUploadSetupComplete && 'border-muted-foreground/30 bg-muted/10',
              upload.isUploading && 'pointer-events-none opacity-70'
            )}
          >
            {upload.pendingFiles.length > 0 ? (
              <>
                <div className="flex flex-col gap-3 text-left sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {upload.pendingFiles.length} material{upload.pendingFiles.length === 1 ? '' : 's'} ready
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
                      upload.handleOpenFilePicker(uploadSetupError);
                    }}
                    disabled={upload.isUploading}
                  >
                    Add Document
                  </Button>
                </div>

                <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1 text-left">
                  {upload.pendingFiles.map((candidate) => {
                    const fileKey = upload.getPendingFileKey(candidate);
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
                            upload.removePendingFile(fileKey);
                          }}
                          disabled={upload.isUploading}
                          aria-label={`Remove ${candidate.name}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>

                {upload.isUploading && upload.currentUploadFileName && (
                  <div className="mt-4 space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{upload.currentUploadFileName}</p>
                      <div className="flex shrink-0 items-center gap-2">
                        {upload.currentUploadFileSize != null && (
                          <span className="text-xs text-muted-foreground">{formatBytes(upload.currentUploadFileSize)}</span>
                        )}
                        {upload.currentUploadIndex && (
                          <Badge variant="secondary" className="text-xs">
                            {upload.currentUploadIndex.current} / {upload.currentUploadIndex.total}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${upload.currentUploadProgress ?? 0}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs font-medium text-muted-foreground">
                        {upload.currentUploadProgress != null ? `${Math.round(upload.currentUploadProgress)}%` : ''}
                      </span>
                    </div>
                    {upload.currentUploadStatusText && (
                      <p className="text-xs text-muted-foreground">{upload.currentUploadStatusText}</p>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation();
                      upload.handleCancelUpload();
                    }}
                  >
                    {upload.isUploading ? 'Cancel Upload' : 'Clear List'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      void upload.handleUpload(uploadCourseId, uploadAccessScope, uploadAcademicTermId);
                    }}
                    disabled={!uploadCourseId || !uploadAccessScope || !uploadAcademicTermId || upload.isUploading || upload.pendingFiles.length === 0}
                  >
                    {upload.isUploading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      `Upload Selected (${upload.pendingFiles.length})`
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
                value={list.searchQuery}
                onChange={(event) => list.setSearchQuery(event.target.value)}
                placeholder="Search uploaded materials"
                className="pl-9"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => list.setShowFilters((current) => !current)}>
                <Filter className="mr-2 h-4 w-4" />
                Filters
              </Button>
            </div>
          </div>

          {list.showFilters && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <Select value={list.courseFilter} onValueChange={list.setCourseFilter}>
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

              <Select value={list.accessFilter} onValueChange={list.setAccessFilter}>
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

              <Select value={list.academicTermFilter} onValueChange={list.setAcademicTermFilter}>
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

              <Select value={list.documentTypeFilter} onValueChange={list.setDocumentTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Document Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Document Type</SelectItem>
                  <SelectItem value="video">Video (MP4/WEBM)</SelectItem>
                  <SelectItem value="notes">Notes (DOCX/PDF/PPTX)</SelectItem>
                </SelectContent>
              </Select>

              <Select value={list.dateFilter} onValueChange={list.setDateFilter}>
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

              <Select value={list.statusFilter} onValueChange={list.setStatusFilter}>
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
                {list.isLoadingMaterials ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading documents...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : list.materials.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <div className="flex flex-col items-center justify-center py-6 text-center text-sm text-muted-foreground">
                        <FileText className="mb-2 h-5 w-5" />
                        No materials match your filters.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  list.materials.map((material) => (
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
                              <Button variant="ghost" size="icon" aria-label={`Open actions for ${material.file_name}`} className="relative">
                                <Ellipsis className="h-4 w-4" />
                                {material.file_type === 'video' && !material.linked_url && (
                                  <span className="absolute right-1 top-1 flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
                                  </span>
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {material.file_type === 'video' ? (
                                <>
                                  <DropdownMenuItem
                                    disabled={material.processing_status !== 'completed'}
                                    onClick={() => actions.handleAttachLink(material)}
                                    className="relative"
                                  >
                                    <FileText className="mr-2 h-4 w-4" />
                                    View attached URL
                                    {!material.linked_url && (
                                      <span className="ml-auto flex h-2 w-2 shrink-0">
                                        <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-destructive opacity-75" />
                                        <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
                                      </span>
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={material.processing_status !== 'completed'}
                                    onClick={() => actions.handleOpenTranscript(material)}
                                  >
                                    <FileText className="mr-2 h-4 w-4" />
                                    View transcript
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={material.processing_status === 'processing' || actions.reindexingIds.has(material.id)}
                                    onClick={() => actions.handleReindexMaterial(material)}
                                  >
                                    <RefreshCw className={`mr-2 h-4 w-4 ${actions.reindexingIds.has(material.id) ? 'animate-spin' : ''}`} />
                                    {actions.reindexingIds.has(material.id) ? 'Re-indexing...' : 'Re-index transcript'}
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                              <DropdownMenuItem onClick={() => actions.openEditFileNameDialog(material)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit filename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => actions.handleDeleteMaterial(material)}
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

          <div className="flex flex-col gap-3 border-t pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing {list.visibleMaterialRangeStart}-{list.visibleMaterialRangeEnd} of {list.totalMaterialsCount} materials
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => list.setMaterialsPage((current) => Math.max(1, current - 1))}
                disabled={list.materialsPage <= 1 || list.isLoadingMaterials}
              >
                Prev
              </Button>
              <span>
                Page {list.materialsPage} of {list.totalMaterialPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => list.setMaterialsPage((current) => Math.min(list.totalMaterialPages, current + 1))}
                disabled={list.materialsPage >= list.totalMaterialPages || list.isLoadingMaterials}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
