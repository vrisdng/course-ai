import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';

import { useAnalyticsChat } from '@/features/analytics-chat/useAnalyticsChat';
import { AnalyticsCard } from '@/features/course-analytics/AnalyticsCard';
import {
  fetchCitedMaterials,
  fetchCitedPlaces,
  fetchQuestionOverview,
  fetchQuestionTerms,
  fetchQuestions,
  type AnalyticsRange,
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
import { CitedFilesCard } from '@/features/course-analytics/CitedFilesCard';
import { NeedsAttentionCard } from '@/features/course-analytics/NeedsAttentionCard';
import { OverviewNumbers } from '@/features/course-analytics/OverviewNumbers';
import { QuestionBucketsPanel } from '@/features/course-analytics/QuestionBucketsPanel';
import {
  NO_FILTERS,
  withoutFilter,
  type FilterName,
  type PlaceChoice,
  type QuestionFilters,
  type SourceKind,
  type TopicFilter,
} from '@/features/course-analytics/questionFilters';
import { QuestionList } from '@/features/course-analytics/QuestionList';
import { TopicsCard } from '@/features/course-analytics/TopicsCard';
import { useLoader } from '@/features/course-analytics/useLoader';
import { useQuestionFeed } from '@/features/course-analytics/useQuestionFeed';
import { useQuestionLabels } from '@/features/course-analytics/useQuestionLabels';
import { useTopicSearch } from '@/features/course-analytics/useTopicSearch';

type Course = {
  id: string;
  name: string;
  code: string | null;
};

// Questions shown as examples in the "Needs attention" card.
const ATTENTION_EXAMPLES = 3;

function daysFor(preset: RangePreset): number {
  return RANGE_PRESETS.find((option) => option.value === preset)?.days ?? 30;
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
  const [filters, setFilters] = useState<QuestionFilters>(NO_FILTERS);
  const questionsRef = useRef<HTMLDivElement>(null);

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
  // Opening the page labels unlabelled questions; version goes up when
  // that changed something, so the views that use labels reload.
  const labels = useQuestionLabels(courseId, range);

  const rangeKey = courseId && range ? `${courseId}|${range.startAt}|${range.endAt}` : null;
  const labelledKey = rangeKey && `${rangeKey}|${labels.version}`;
  const overview = useLoader(labelledKey && `overview|${labelledKey}`, () => fetchQuestionOverview(courseId!, range!));
  const terms = useLoader(labelledKey && `terms|${labelledKey}`, () => fetchQuestionTerms(courseId!, range!));
  const attentionExamples = useLoader(labelledKey && `attention|${labelledKey}`, async () =>
    (await fetchQuestions(courseId!, range!, { ...NO_FILTERS, needsAttention: true }, { limit: ATTENTION_EXAMPLES, offset: 0 })).questions);
  const files = useLoader(rangeKey && `files|${rangeKey}`, () => fetchCitedMaterials(courseId!, range!));
  const places = useLoader(rangeKey && `places|${rangeKey}`, () => fetchCitedPlaces(courseId!, range!));
  const feed = useQuestionFeed(courseId, range, filters, labels.version);

  const setTopic = useCallback((topic: TopicFilter | null) => setFilters((current) => ({ ...current, topic })), []);
  const search = useTopicSearch(courseId, setTopic);
  const { setInput: setSearchInput } = search;

  const changeCourse = (id: string) => {
    setSelectedCourseId(id);
    setFilters(NO_FILTERS);
    setSearchInput('');
  };

  const showQuestions = () => questionsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  const selectTerm = (term: string) => {
    setSearchInput('');
    setFilters((current) => ({
      ...current,
      topic: current.topic?.source === 'term' && current.topic.text === term ? null : { text: term, places: null, source: 'term' },
    }));
  };
  const selectFile = (file: { id: string; name: string }) =>
    setFilters((current) => ({ ...current, material: current.material?.id === file.id ? null : file }));
  const selectSourceKind = (kind: SourceKind) =>
    setFilters((current) => ({ ...current, sourceKind: current.sourceKind === kind ? null : kind }));
  const selectCategory = (category: string) =>
    setFilters((current) => ({ ...current, category: current.category === category ? null : category }));
  const selectPlace = (place: PlaceChoice) => {
    setFilters((current) => ({ ...current, place: current.place?.key === place.key ? null : place }));
    showQuestions();
  };
  const showNeedsAttention = () => {
    setFilters((current) => ({ ...current, needsAttention: true }));
    showQuestions();
  };
  const removeFilter = (name: FilterName) => {
    if (name === 'topic') setSearchInput('');
    setFilters((current) => withoutFilter(current, name));
  };
  const clearFilters = () => {
    setSearchInput('');
    setFilters(NO_FILTERS);
  };

  const rangeLabel = range ? formatRangeLabel(range) : null;

  return (
    <MainLayout showFooter={false}>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Course analytics</h1>
            <p className="text-sm text-muted-foreground">
              What students are asking, and where your materials help or fall short.
            </p>
          </div>
          {!isLoadingCourses && courses.length > 0 && (
            <Select value={selectedCourseId} onValueChange={changeCourse}>
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

            <OverviewNumbers overview={overview} onShowNeedsAttention={showNeedsAttention} />

            <NeedsAttentionCard
              count={overview.data?.needsAttentionCount ?? null}
              examples={attentionExamples}
              places={places}
              onShowNeedsAttention={showNeedsAttention}
              onSelectPlace={selectPlace}
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div ref={questionsRef} className="min-w-0 scroll-mt-20">
                <QuestionList
                  feed={feed}
                  search={search}
                  filters={filters}
                  onRemoveFilter={removeFilter}
                  onClearFilters={clearFilters}
                  onSelectPlace={selectPlace}
                />
              </div>

              <aside className="min-w-0 space-y-6">
                <TopicsCard
                  terms={terms}
                  selected={filters.topic?.source === 'term' ? filters.topic.text : null}
                  onSelect={selectTerm}
                />
                <CitedFilesCard
                  files={files}
                  overview={overview.data}
                  selectedFileId={filters.material?.id ?? null}
                  selectedSourceKind={filters.sourceKind}
                  onSelectFile={selectFile}
                  onSelectSourceKind={selectSourceKind}
                />
                <AnalyticsCard title="Question types" description="What kind of questions students asked.">
                  <QuestionBucketsPanel state={labels} selected={filters.category} onSelect={selectCategory} />
                </AnalyticsCard>
                <AnalyticsCard
                  title="Ask about this data"
                  description="Chat with an assistant that can see this course's usage for the selected dates."
                >
                  <AskAnalyticsSheet chat={chat} disabledReason={rangeError} rangeLabel={rangeLabel} />
                </AnalyticsCard>
              </aside>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}
