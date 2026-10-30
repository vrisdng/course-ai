import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { CoursesOverviewTab } from '@/components/lecturer/CoursesOverviewTab';
import { MaterialsTab } from '@/components/lecturer/MaterialsTab';
import { CourseChatSettingsPanel } from '@/features/chat-settings/CourseChatSettingsPanel';
import { SystemMaintenancePanel, type JobRecoveryResult } from '@/components/lecturer/SystemMaintenancePanel';
import { supabase } from '@/integrations/supabase/client';
import { formatTimestamp } from '@/features/student-chat/time';
import type { AcademicTerm, Course } from '@/features/materials/types';

export type { Course, AcademicTerm, Material, TranscriptSegment } from '@/features/materials/types';
export const formatClock = formatTimestamp;

export default function AdminDashboard() {
  const { profile, user } = useAuth();

  const [courses, setCourses] = useState<Course[]>([]);
  const [academicTerms, setAcademicTerms] = useState<AcademicTerm[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [isLoadingTerms, setIsLoadingTerms] = useState(true);

  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');
  const [newCourseDescription, setNewCourseDescription] = useState('');
  const [newTermSemester, setNewTermSemester] = useState<'1' | '2'>('1');
  const [newTermAyStart, setNewTermAyStart] = useState<string>(String(new Date().getFullYear()));
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [isCreatingTerm, setIsCreatingTerm] = useState(false);
  const [activatingTermId, setActivatingTermId] = useState<string | null>(null);
  const fetchCourses = useCallback(async () => {
    setIsLoadingCourses(true);
    const coursesResult = await supabase.from('courses').select('id, name, code').order('name');

    if (coursesResult.error) {
      toast.error('Failed to load courses');
      setIsLoadingCourses(false);
      return;
    }

    const nextCourses = (coursesResult.data || []) as Course[];
    setCourses(nextCourses);

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

    setIsLoadingTerms(false);
  }, []);

  useEffect(() => {
    void fetchCourses();
    void fetchAcademicTerms();
  }, [fetchAcademicTerms, fetchCourses]);

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
    setNewCourseName('');
    setNewCourseCode('');
    setNewCourseDescription('');
    setIsCreatingCourse(false);
    toast.success('Course created');
  };

  const handleDeleteCourse = async (course: Course) => {
    const label = `${course.name}${course.code ? ` (${course.code})` : ''}`;
    const shouldDelete = window.confirm(
      `Delete ${label}? This permanently removes the course and all its documents, chunks, and enrollments. This cannot be undone.`
    );
    if (!shouldDelete) {
      return;
    }

    const { error } = await supabase.from('courses').delete().eq('id', course.id);
    if (error) {
      toast.error(error.message);
      return;
    }

    setCourses((prev) => prev.filter((c) => c.id !== course.id));
    toast.success('Course deleted');
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
    const { error } = await supabase
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
    setActivatingTermId(null);
    toast.success('Active academic term updated');
  };

  const handleDeleteAcademicTerm = async (term: AcademicTerm) => {
    if (!profile || profile.role !== 'admin') {
      toast.error('Only admins can delete academic terms');
      return;
    }
    if (term.is_active) {
      toast.error('Set another term active before deleting this one');
      return;
    }

    const shouldDelete = window.confirm(
      `Delete ${term.label}? This cannot be undone. Terms with documents attached cannot be deleted.`
    );
    if (!shouldDelete) {
      return;
    }

    const { error } = await supabase.from('academic_terms').delete().eq('id', term.id);
    if (error) {
      // materials.academic_term_id is ON DELETE RESTRICT
      toast.error(
        error.code === '23503'
          ? 'This term has documents attached. Remove or reassign them first.'
          : error.message
      );
      return;
    }

    setAcademicTerms((prev) => prev.filter((t) => t.id !== term.id));
    toast.success('Academic term deleted');
  };

  const handleRefreshDashboard = async (): Promise<void> => {
    await Promise.all([fetchCourses(), fetchAcademicTerms()]);
  };

  const handleRecoverProcessingJobs = async (): Promise<JobRecoveryResult> => {
    const { data, error } = await supabase.functions.invoke('reap-stale-jobs');
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return {
      reaped: Number(data?.reaped ?? 0),
      triggeredWorkers: Number(data?.triggeredWorkers ?? 0),
    };
  };

  return (
    <MainLayout showFooter={false}>
      <div className="container py-6 sm:py-8">
        <div className="mb-6 flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Document Details</h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Manage course documents for RAG. Only enrolled students and course staff can access uploaded files.
            </p>
          </div>
        </div>

        <Tabs defaultValue="add-document" className="space-y-6">
          <TabsList className="scrollbar-hide flex h-auto w-full justify-start overflow-x-auto border-b border-border bg-transparent p-0 text-sm">
            <TabsTrigger
              value="overview"
              className="-mb-px shrink-0 rounded-none border-b-2 border-transparent px-3 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-4"
            >
              Courses Overview
            </TabsTrigger>
            <TabsTrigger
              value="add-document"
              className="-mb-px shrink-0 rounded-none border-b-2 border-transparent px-3 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-4"
            >
              + Add Document
            </TabsTrigger>
            {profile?.role === 'admin' && (
              <TabsTrigger
                value="chat-settings"
                className="-mb-px shrink-0 rounded-none border-b-2 border-transparent px-3 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-4"
              >
                Chat Settings
              </TabsTrigger>
            )}
            {profile?.role === 'admin' && (
              <TabsTrigger
                value="maintenance"
                className="-mb-px shrink-0 rounded-none border-b-2 border-transparent px-3 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-4"
              >
                System Maintenance
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="mt-0 space-y-5">
            <CoursesOverviewTab
              isAdmin={profile?.role === 'admin'}
              courses={courses}
              isLoadingCourses={isLoadingCourses}
              newCourseName={newCourseName}
              newCourseCode={newCourseCode}
              newCourseDescription={newCourseDescription}
              isCreatingCourse={isCreatingCourse}
              onNewCourseNameChange={setNewCourseName}
              onNewCourseCodeChange={setNewCourseCode}
              onNewCourseDescriptionChange={setNewCourseDescription}
              onCreateCourse={() => void handleCreateCourse()}
              onDeleteCourse={(course) => void handleDeleteCourse(course)}
              academicTerms={academicTerms}
              isLoadingTerms={isLoadingTerms}
              newTermSemester={newTermSemester}
              newTermAyStart={newTermAyStart}
              isCreatingTerm={isCreatingTerm}
              activatingTermId={activatingTermId}
              onNewTermSemesterChange={setNewTermSemester}
              onNewTermAyStartChange={setNewTermAyStart}
              onCreateAcademicTerm={() => void handleCreateAcademicTerm()}
              onSetActiveTerm={(termId) => void handleSetActiveTerm(termId)}
              onDeleteAcademicTerm={(term) => void handleDeleteAcademicTerm(term)}
            />
          </TabsContent>

          <TabsContent value="add-document" className="mt-0 space-y-5">
            <MaterialsTab
              uploaderId={profile?.id}
              courses={courses}
              academicTerms={academicTerms}
              isLoadingTerms={isLoadingTerms}
            />
          </TabsContent>

          {profile?.role === 'admin' && (
            <TabsContent value="chat-settings" className="mt-0 space-y-5">
              <CourseChatSettingsPanel courses={courses} isLoadingCourses={isLoadingCourses} userId={user?.id} />
            </TabsContent>
          )}

          <TabsContent value="maintenance" className="mt-0 space-y-5">
            <SystemMaintenancePanel
              isAdmin={profile?.role === 'admin'}
              onRefresh={handleRefreshDashboard}
              onRecoverJobs={handleRecoverProcessingJobs}
            />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
