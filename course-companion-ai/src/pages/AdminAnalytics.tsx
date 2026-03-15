import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, MessageSquare, RotateCcw, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
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

function startAtIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const STAT_ITEMS = [
  { key: 'enrolledStudents' as const, label: 'Enrolled Students', icon: Users },
  { key: 'activeStudents' as const, label: 'Active (30d)', icon: UserCheck },
  { key: 'documents' as const, label: 'Documents', icon: FileText },
  { key: 'totalQuestions' as const, label: 'Questions (30d)', icon: MessageSquare },
];

export default function AdminAnalytics() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [stats, setStats] = useState<CourseStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, input, setInput, isLoading, handleSend, stopGenerating, clearChat } =
    useAnalyticsChat(selectedCourseId || null);

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
      return;
    }

    let cancelled = false;
    setIsLoadingStats(true);

    const start = startAtIso(30);

    Promise.all([
      supabase
        .from('enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('course_id', selectedCourseId),
      supabase.rpc('get_course_active_student_count' as string, {
        in_course_id: selectedCourseId,
        in_start_at: start,
      }),
      supabase
        .from('materials')
        .select('id', { count: 'exact', head: true })
        .eq('course_id', selectedCourseId),
      supabase
        .from('query_events')
        .select('id', { count: 'exact', head: true })
        .eq('course_id', selectedCourseId)
        .gte('created_at', start),
    ]).then(([enrollmentRes, activeRes, materialsRes, questionsRes]) => {
      if (cancelled) return;
      setStats({
        enrolledStudents: enrollmentRes.count ?? 0,
        activeStudents: typeof activeRes.data === 'number' ? activeRes.data : 0,
        documents: materialsRes.count ?? 0,
        totalQuestions: questionsRes.count ?? 0,
      });
      setIsLoadingStats(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedCourseId]);

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
          <div className="flex items-center justify-between px-2">
            <div>
              <h1 className="text-lg font-semibold">Course Analytics</h1>
              <p className="text-xs text-muted-foreground">
                Ask questions about student activity and course usage
              </p>
            </div>
            <div className="flex items-center gap-2">
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
              {STAT_ITEMS.map((item) => {
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
              {STAT_ITEMS.map((item) => {
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
              onInputChange={setInput}
              onSend={handleSend}
              onStop={stopGenerating}
              placeholder="Ask about your course analytics..."
              footerText="Answers are generated from your course's usage data"
            />
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
