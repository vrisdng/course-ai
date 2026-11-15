import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

import { useAnalyticsChat } from '@/features/analytics-chat/useAnalyticsChat';
import {
  fetchCitedFiles,
  fetchQuestionDetail,
  fetchQuestionOverview,
  type AnalyticsRange,
  type QuestionOverview,
} from '@/features/course-analytics/analyticsApi';
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
import { AskAnalyticsSheet } from '@/features/course-analytics/AskAnalyticsSheet';
import { NavPane } from '@/features/course-analytics/NavPane';
import { plural } from '@/features/course-analytics/questionCategories';
import { QuestionDetailPane } from '@/features/course-analytics/QuestionDetailPane';
import { QuestionSearch } from '@/features/course-analytics/QuestionSearch';
import {
  ALL_QUESTIONS,
  filtersFor,
  selectionTitle,
  type Selection,
} from '@/features/course-analytics/questionFilters';
import { QuestionsPane } from '@/features/course-analytics/QuestionsPane';
import { useLoader } from '@/features/course-analytics/useLoader';
import { useQuestionFeed } from '@/features/course-analytics/useQuestionFeed';
import { useQuestionLabels } from '@/features/course-analytics/useQuestionLabels';
import { useTopicSearch } from '@/features/course-analytics/useTopicSearch';

type Course = {
  id: string;
  name: string;
  code: string | null;
};

// Small screens show one pane at a time.
type MobilePane = 'nav' | 'list' | 'detail';

function daysFor(preset: RangePreset): number {
  return RANGE_PRESETS.find((option) => option.value === preset)?.days ?? 30;
}

// The overview is already filtered by the study-only toggle.
function summary(overview: QuestionOverview): string {
  const parts = [plural(overview.questionCount, 'question'), plural(overview.studentCount, 'student')];
  if (overview.materialsJudgedCount > 0) {
    parts.push(`${Math.round((overview.answeredFromMaterialsCount / overview.materialsJudgedCount) * 100)}% answered from materials`);
  }
  return parts.join(' · ');
}

export default function AdminAnalytics() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);

  // A preset's window is fixed when it is picked, so it doesn't drift on re-render.
  const [preset, setPreset] = useState<RangePreset>(DEFAULT_PRESET);
  const [presetWindow, setPresetWindow] = useState<AnalyticsRange>(() => presetRange(daysFor(DEFAULT_PRESET)));
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [selection, setSelection] = useState<Selection>(ALL_QUESTIONS);
  const [studyOnly, setStudyOnly] = useState(true);
  const [questionId, setQuestionId] = useState<string | null>(null);
  // Phones start on the views, the top of the drill-down.
  const [mobilePane, setMobilePane] = useState<MobilePane>('nav');

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

  const chat = useAnalyticsChat(courseId, range?.startAt ?? null, range?.endAt ?? null);
  // Opening the page labels unlabelled questions; version goes up when that
  // changed something, so the views that use labels reload.
  const labels = useQuestionLabels(courseId, range, studyOnly);

  const rangeKey = courseId && range ? `${courseId}|${range.startAt}|${range.endAt}` : null;
  const labelledKey = rangeKey && `${rangeKey}|${labels.version}`;
  // The counts follow the study-only toggle so they match the list they open.
  const overview = useLoader(
    labelledKey && `overview|${labelledKey}|${studyOnly}`,
    () => fetchQuestionOverview(courseId!, range!, studyOnly),
  );
  const files = useLoader(
    labelledKey && `files|${labelledKey}|${studyOnly}`,
    () => fetchCitedFiles(courseId!, range!, studyOnly),
  );

  const filters = useMemo(() => filtersFor(selection, studyOnly), [selection, studyOnly]);
  const feed = useQuestionFeed(courseId, range, filters, labels.version);
  const detail = useLoader(
    labelledKey && questionId ? `detail|${labelledKey}|${questionId}` : null,
    () => fetchQuestionDetail(courseId!, range!, questionId!),
  );

  // Keep a question open: the first one of each new list, unless the open
  // one is in it.
  useEffect(() => {
    if (feed.isLoading) return;
    setQuestionId((current) => {
      if (current && feed.questions.some((question) => question.id === current)) return current;
      return feed.questions[0]?.id ?? null;
    });
  }, [feed.isLoading, feed.questions]);

  const onSearch = useCallback((next: Selection | null) => {
    setSelection(next ?? ALL_QUESTIONS);
    setMobilePane('list');
  }, []);
  const search = useTopicSearch(courseId, onSearch);
  const { reset: resetSearch } = search;

  // Picking a view or course drops any search still running, so its late
  // result can't replace what was picked.
  const select = (next: Selection) => {
    resetSearch();
    setSelection(next);
    setMobilePane('list');
  };
  const openQuestion = (id: string) => {
    setQuestionId(id);
    setMobilePane('detail');
  };
  const changeCourse = (id: string) => {
    setSelectedCourseId(id);
    resetSearch();
    setSelection(ALL_QUESTIONS);
  };

  const rangeLabel = range ? formatRangeLabel(range) : null;

  return (
    <MainLayout showFooter={false}>
      <div className="flex h-[calc(100dvh-4rem-1px)] min-h-[32rem] flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Course analytics</h1>
          {courses.length > 0 && (
            <>
              <Select value={selectedCourseId} onValueChange={changeCourse}>
                <SelectTrigger className="h-8 w-full text-left sm:w-[220px]" aria-label="Course">
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
              <AnalyticsRangePicker
                preset={preset}
                onPresetChange={handlePresetChange}
                customStart={customStart}
                customEnd={customEnd}
                onCustomStartChange={setCustomStart}
                onCustomEndChange={setCustomEnd}
                error={rangeError}
                rangeLabel={rangeLabel}
              />
              <p className="text-sm text-muted-foreground">
                {overview.data ? summary(overview.data) : rangeLabel}
              </p>
              <div className="ml-auto">
                <AskAnalyticsSheet chat={chat} disabledReason={rangeError} rangeLabel={rangeLabel} />
              </div>
            </>
          )}
        </div>

        {isLoadingCourses ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading courses" />
          </div>
        ) : courses.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No courses yet. Create a course to see its analytics.
          </p>
        ) : !range ? (
          <p className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {rangeError ?? 'Choose the dates to look at.'}
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,380px)_minmax(0,1fr)]">
            <aside className={cn('min-h-0 overflow-y-auto border-border lg:block lg:border-r', mobilePane !== 'nav' && 'hidden')}>
              <div className="p-3 pb-0">
                <QuestionSearch search={search} />
              </div>
              <NavPane
                overview={overview}
                files={files}
                labels={labels}
                selection={selection}
                onSelect={select}
              />
            </aside>
            <section
              aria-label="Questions"
              className={cn('min-h-0 border-border lg:block lg:border-r', mobilePane !== 'list' && 'hidden')}
            >
              <QuestionsPane
                title={selectionTitle(selection)}
                feed={feed}
                studyOnly={studyOnly}
                onStudyOnlyChange={setStudyOnly}
                selectedId={questionId}
                onSelectQuestion={openQuestion}
                onBack={() => setMobilePane('nav')}
              />
            </section>
            <section
              aria-label="Question detail"
              className={cn('min-h-0 overflow-y-auto lg:block', mobilePane !== 'detail' && 'hidden')}
            >
              <QuestionDetailPane
                detail={detail}
                hasSelection={questionId !== null}
                onSelectQuestion={(id) => setQuestionId(id)}
                onBack={() => setMobilePane('list')}
              />
            </section>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
