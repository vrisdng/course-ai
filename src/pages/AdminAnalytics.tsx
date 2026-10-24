import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';

import { useAnalyticsChat } from '@/features/analytics-chat/useAnalyticsChat';
import type { AnalyticsRange } from '@/features/course-analytics/analyticsApi';
import {
  DEFAULT_PRESET,
  RANGE_PRESETS,
  formatDateTimeLocalValue,
  formatRangeLabel,
  presetRange,
  resolveCustomRange,
  type RangePreset,
} from '@/features/course-analytics/analyticsRange';
import { AnalyticsRangePicker } from '@/features/course-analytics/AnalyticsRangePicker';
import { AnalyticsSummary, type CourseStats } from '@/features/course-analytics/AnalyticsSummary';
import { AskAnalyticsSheet } from '@/features/course-analytics/AskAnalyticsSheet';
import { MaterialsExplorer } from '@/features/course-analytics/MaterialsExplorer';
import { QuestionBucketsPanel } from '@/features/course-analytics/QuestionBucketsPanel';
import { useCitedMaterials } from '@/features/course-analytics/useCitedMaterials';
import { useKeywordSearch } from '@/features/course-analytics/useKeywordSearch';
import { useQuestionLabels } from '@/features/course-analytics/useQuestionLabels';

type Course = {
  id: string;
  name: string;
  code: string | null;
};

function daysFor(preset: RangePreset): number {
  return RANGE_PRESETS.find((option) => option.value === preset)?.days ?? 30;
}

export default function AdminAnalytics() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [stats, setStats] = useState<CourseStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // A preset's window is fixed when it is picked, so it doesn't drift on re-render.
  const [preset, setPreset] = useState<RangePreset>(DEFAULT_PRESET);
  const [presetWindow, setPresetWindow] = useState<AnalyticsRange>(() => presetRange(daysFor(DEFAULT_PRESET)));
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const custom = useMemo(() => resolveCustomRange(customStart, customEnd), [customStart, customEnd]);
  const range: AnalyticsRange | null = preset === 'custom' ? custom.range : presetWindow;
  const rangeError = preset === 'custom' ? custom.error : null;
  const courseId = selectedCourseId || null;

  const handlePresetChange = useCallback((next: RangePreset) => {
    if (next === 'custom') {
      // Start from the window currently shown.
      setCustomStart(formatDateTimeLocalValue(new Date(presetWindow.startAt)));
      setCustomEnd(formatDateTimeLocalValue(new Date(presetWindow.endAt)));
    } else {
      setPresetWindow(presetRange(daysFor(next)));
    }
    setPreset(next);
  }, [presetWindow]);

  const chat = useAnalyticsChat(courseId, range?.startAt ?? null, range?.endAt ?? null);
  // All views load when the page opens, so question labelling starts at once.
  const citedMaterials = useCitedMaterials(courseId, range);
  const keywordSearch = useKeywordSearch(courseId, range);
  const questionLabels = useQuestionLabels(courseId, range);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from('courses').select('id, name, code').order('name');
      if (error) {
        toast.error(error.message || 'Failed to load courses');
        setCourses([]);
      } else {
        const nextCourses = (data || []) as Course[];
        setCourses(nextCourses);
        setSelectedCourseId((current) => current || nextCourses[0]?.id || '');
      }
      setIsLoadingCourses(false);
    })();
  }, []);

  const startAt = range?.startAt ?? null;
  const endAt = range?.endAt ?? null;

  useEffect(() => {
    if (!selectedCourseId || !startAt || !endAt) {
      setStats(null);
      setIsLoadingStats(false);
      return;
    }

    let cancelled = false;
    setIsLoadingStats(true);
    Promise.all([
      supabase.from('enrollments').select('id', { count: 'exact', head: true }).eq('course_id', selectedCourseId),
      supabase.rpc('get_course_active_student_count', { in_course_id: selectedCourseId, in_start_at: startAt, in_end_at: endAt }),
      supabase.from('materials').select('id', { count: 'exact', head: true }).eq('course_id', selectedCourseId),
      supabase
        .from('query_events')
        .select('id', { count: 'exact', head: true })
        .eq('outcome', 'success')
        .is('error_code', null)
        .eq('course_id', selectedCourseId)
        .gte('created_at', startAt)
        .lte('created_at', endAt),
    ])
      .then(([enrollmentRes, activeRes, materialsRes, questionsRes]) => {
        if (cancelled) return;
        setStats({
          enrolledStudents: enrollmentRes.count ?? 0,
          activeStudents: typeof activeRes.data === 'number' ? activeRes.data : 0,
          documents: materialsRes.count ?? 0,
          totalQuestions: questionsRes.count ?? 0,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load analytics stats:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to load analytics stats');
        setStats(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingStats(false);
      });

    return () => {
      cancelled = true;
    };
  }, [endAt, selectedCourseId, startAt]);

  const rangeLabel = range ? formatRangeLabel(range) : null;

  return (
    <MainLayout showFooter={false}>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Course analytics</h1>
            <p className="text-sm text-muted-foreground">
              What students ask about, traced to the materials their answers cite.
            </p>
          </div>
          {!isLoadingCourses && courses.length > 0 && (
            <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
              <SelectTrigger className="w-full sm:w-[280px]" aria-label="Course">
                <SelectValue placeholder="Select a course" />
              </SelectTrigger>
              <SelectContent>
                {courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.name}{course.code ? ` (${course.code})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </header>

        {isLoadingCourses ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading courses" />
          </div>
        ) : courses.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            No courses yet. Create a course to see its analytics.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <AnalyticsRangePicker
                preset={preset}
                onPresetChange={handlePresetChange}
                customStart={customStart}
                customEnd={customEnd}
                onCustomStartChange={setCustomStart}
                onCustomEndChange={setCustomEnd}
                error={rangeError}
              />
              {rangeLabel && <p className="text-sm text-muted-foreground sm:pt-2">{rangeLabel}</p>}
            </div>

            <AnalyticsSummary
              isLoading={isLoadingStats}
              stats={stats}
              buckets={questionLabels.buckets}
              citedMaterialCount={range ? citedMaterials.materials.length : null}
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <MaterialsExplorer materials={citedMaterials} keyword={keywordSearch} />

              <aside className="min-w-0 space-y-6">
                <section aria-labelledby="types-heading" className="rounded-xl border border-border bg-card p-5">
                  <h2 id="types-heading" className="text-base font-semibold">Question types</h2>
                  <p className="mb-4 text-sm text-muted-foreground">What kind of questions students asked.</p>
                  <QuestionBucketsPanel state={questionLabels} />
                </section>

                <section aria-labelledby="ask-heading" className="rounded-xl border border-border bg-card p-5">
                  <h2 id="ask-heading" className="text-base font-semibold">Ask about this data</h2>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Chat with an assistant that can see this course's usage for the selected dates.
                  </p>
                  <AskAnalyticsSheet chat={chat} disabledReason={rangeError} rangeLabel={rangeLabel} />
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}
