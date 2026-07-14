import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, FileText, Loader2, MessageSquare, RotateCcw, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';

import { AnalyticsChatMessageList } from '@/features/analytics-chat/AnalyticsChatMessageList';
import { useAnalyticsChat } from '@/features/analytics-chat/useAnalyticsChat';
import { ChatComposer } from '@/features/student-chat/ChatComposer';

type Course = {
  id: string;
  name: string;
  code: string | null;
};

interface CourseStats {
  enrolledStudents: number;
  activeStudents: number;
  documents: number;
  totalQuestions: number;
}

function padDateTimePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTimeLocalValue(date: Date): string {
  return [
    date.getFullYear(),
    padDateTimePart(date.getMonth() + 1),
    padDateTimePart(date.getDate()),
  ].join('-') + `T${padDateTimePart(date.getHours())}:${padDateTimePart(date.getMinutes())}`;
}

function parseDateTimeLocalValue(value: string): Date | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatAnalyticsRangeLabel(startAt: string | null, endAt: string | null): string {
  if (!startAt || !endAt) {
    return 'a valid selected range';
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${formatter.format(new Date(startAt))} to ${formatter.format(new Date(endAt))}`;
}

export default function AdminAnalytics() {
  const defaultRangeEnd = new Date();
  const defaultRangeStart = new Date(defaultRangeEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [rangeStartInput, setRangeStartInput] = useState<string>(formatDateTimeLocalValue(defaultRangeStart));
  const [rangeEndInput, setRangeEndInput] = useState<string>(formatDateTimeLocalValue(defaultRangeEnd));
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [stats, setStats] = useState<CourseStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const parsedRangeStart = parseDateTimeLocalValue(rangeStartInput);
  const parsedRangeEnd = parseDateTimeLocalValue(rangeEndInput);
  const analyticsRangeError =
    !rangeStartInput.trim()
      ? 'Choose a start date and time.'
      : !parsedRangeStart
        ? 'Enter a valid start date and time.'
        : !rangeEndInput.trim()
          ? 'Choose an end date and time.'
          : !parsedRangeEnd
            ? 'Enter a valid end date and time.'
            : parsedRangeStart.getTime() > parsedRangeEnd.getTime()
              ? 'Start date and time must be earlier than or equal to the end date and time.'
              : null;
  const analyticsStartAt = analyticsRangeError || !parsedRangeStart ? null : parsedRangeStart.toISOString();
  const analyticsEndAt = analyticsRangeError || !parsedRangeEnd ? null : parsedRangeEnd.toISOString();
  const statItems = [
    { key: 'enrolledStudents' as const, label: 'Enrolled Students', icon: Users },
    { key: 'activeStudents' as const, label: 'Active Students', icon: UserCheck },
    { key: 'documents' as const, label: 'Documents', icon: FileText },
    { key: 'totalQuestions' as const, label: 'Questions', icon: MessageSquare },
  ];

  const { messages, input, setInput, isLoading, handleSend, stopGenerating, clearChat } =
    useAnalyticsChat(selectedCourseId || null, analyticsStartAt, analyticsEndAt);

  const fetchCourses = useCallback(async () => {
    const { data, error } = await supabase
      .from('courses')
      .select('id, name, code')
      .order('name');

    if (error) {
      toast.error(error.message || 'Failed to load courses');
      setCourses([]);
      setSelectedCourseId('');
      setIsLoadingCourses(false);
      return;
    }

    const nextCourses = (data || []) as Course[];
    setCourses(nextCourses);
    setSelectedCourseId((current) => current || nextCourses[0]?.id || '');
    setIsLoadingCourses(false);
  }, []);

  useEffect(() => {
    void fetchCourses();
  }, [fetchCourses]);

  // Fetch stats when course changes
  useEffect(() => {
    if (!selectedCourseId) {
      setStats(null);
      setIsLoadingStats(false);
      return;
    }

    if (analyticsRangeError || !analyticsStartAt || !analyticsEndAt) {
      setStats(null);
      setIsLoadingStats(false);
      return;
    }

    let cancelled = false;
    setIsLoadingStats(true);

    const questionsQuery = supabase
      .from('query_events')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', selectedCourseId)
      .gte('created_at', analyticsStartAt)
      .lte('created_at', analyticsEndAt);

    Promise.all([
      supabase
        .from('enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('course_id', selectedCourseId),
      supabase.rpc('get_course_active_student_count', {
        in_course_id: selectedCourseId,
        in_start_at: analyticsStartAt,
        in_end_at: analyticsEndAt,
      }),
      supabase
        .from('materials')
        .select('id', { count: 'exact', head: true })
        .eq('course_id', selectedCourseId),
      questionsQuery,
    ])
      .then(([enrollmentRes, activeRes, materialsRes, questionsRes]) => {
        if (cancelled) return;
        setStats({
          enrolledStudents: enrollmentRes.count ?? 0,
          activeStudents: typeof activeRes.data === 'number' ? activeRes.data : 0,
          documents: materialsRes.count ?? 0,
          totalQuestions: questionsRes.count ?? 0,
        });
        setIsLoadingStats(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load analytics stats:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to load analytics stats');
        setStats(null);
        setIsLoadingStats(false);
      });

    return () => {
      cancelled = true;
    };
  }, [analyticsEndAt, analyticsRangeError, analyticsStartAt, selectedCourseId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      setInput(suggestion);
    },
    [setInput],
  );

  const handleResetDateRange = useCallback(() => {
    const nextRangeEnd = new Date();
    const nextRangeStart = new Date(nextRangeEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    setRangeStartInput(formatDateTimeLocalValue(nextRangeStart));
    setRangeEndInput(formatDateTimeLocalValue(nextRangeEnd));
  }, []);

  const handleAnalyticsSend = useCallback(() => {
    if (analyticsRangeError) {
      toast.error(analyticsRangeError);
      return;
    }

    handleSend();
  }, [analyticsRangeError, handleSend]);

  if (isLoadingCourses) {
    return (
      <MainLayout showFooter={false}>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout showFooter={false}>
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        {/* Header */}
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-col gap-3 px-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-lg font-semibold">Course Analytics</h1>
              <p className="text-xs text-muted-foreground">
                Ask questions about student activity and course usage
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Select
                value={selectedCourseId}
                onValueChange={setSelectedCourseId}
                disabled={courses.length === 0}
              >
                <SelectTrigger className="w-[200px]">
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
              <div className="space-y-1">
                <Label htmlFor="analytics-start-at" className="text-xs text-muted-foreground">Start</Label>
                <Input
                  id="analytics-start-at"
                  type="datetime-local"
                  value={rangeStartInput}
                  onChange={(event) => setRangeStartInput(event.target.value)}
                  className="w-[220px]"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="analytics-end-at" className="text-xs text-muted-foreground">End</Label>
                <Input
                  id="analytics-end-at"
                  type="datetime-local"
                  value={rangeEndInput}
                  onChange={(event) => setRangeEndInput(event.target.value)}
                  className="w-[220px]"
                />
              </div>
              <Button variant="outline" onClick={handleResetDateRange}>
                Last 30 days
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={clearChat}
                title="Clear chat"
                disabled={messages.length === 0 && !isLoading}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {analyticsRangeError ? (
            <div className="mt-3 flex items-center gap-2 px-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{analyticsRangeError}</span>
            </div>
          ) : (
            <p className="mt-3 px-2 text-xs text-muted-foreground">
              Showing analytics for {formatAnalyticsRangeLabel(analyticsStartAt, analyticsEndAt)}.
            </p>
          )}
        </div>

        {/* Main content: sidebar + chat */}
        <div className="flex flex-1 overflow-hidden">
          {/* Stats sidebar */}
          <aside className="hidden w-[220px] shrink-0 border-r border-border md:block">
            <div className="space-y-1 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Overview
              </h2>
            </div>
            <nav className="space-y-1 px-4 pb-4">
              {statItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.key}
                    className="flex items-center gap-3 rounded-lg px-3 py-3"
                  >
                    <div className="rounded-md bg-muted p-2 text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      {isLoadingStats ? (
                        <Skeleton className="mt-1 h-5 w-10" />
                      ) : (
                        <p className="text-lg font-semibold">
                          {stats ? stats[item.key] : '—'}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </nav>
          </aside>

          {/* Chat area */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Mobile stats bar */}
            <div className="flex gap-4 overflow-x-auto border-b border-border px-4 py-2 md:hidden">
              {statItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.key} className="flex shrink-0 items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{item.label}:</span>
                    {isLoadingStats ? (
                      <Skeleton className="h-4 w-6" />
                    ) : (
                      <span className="text-sm font-semibold">
                        {stats ? stats[item.key] : '—'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <ScrollArea className="flex-1">
              <div className="mx-auto max-w-3xl space-y-6 p-4">
                <AnalyticsChatMessageList
                  messages={messages}
                  onSuggestionClick={handleSuggestionClick}
                />
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <ChatComposer
              input={input}
              isLoading={isLoading}
              disabled={Boolean(analyticsRangeError)}
              onInputChange={setInput}
              onSend={handleAnalyticsSend}
              onStop={stopGenerating}
              placeholder="Ask about your course analytics..."
              footerText={
                analyticsRangeError
                  ? 'Fix the analytics date range to ask questions.'
                  : `Answers are generated from your course's usage data for ${formatAnalyticsRangeLabel(analyticsStartAt, analyticsEndAt)}`
              }
            />
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
