import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Hash, Loader2, MessageSquareText, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Course = {
  id: string;
  name: string;
  code: string | null;
};

type DocumentReferenceStat = Database['public']['Functions']['get_course_document_reference_stats']['Returns'][number];
type KeywordStat = Database['public']['Functions']['get_course_keyword_stats']['Returns'][number];
type TopQuestionStat = Database['public']['Functions']['get_course_top_questions']['Returns'][number];

type TimeWindow = '7d' | '30d' | '90d';
type QuestionLimit = '5' | '10';

const timeWindowStartIso = (window: TimeWindow) => {
  const now = new Date();
  const days = window === '7d' ? 7 : window === '30d' ? 30 : 90;
  now.setDate(now.getDate() - days);
  return now.toISOString();
};

const formatDateTime = (value: string | null) => {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
};

const formatFileType = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default function AdminAnalytics() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('30d');
  const [questionLimit, setQuestionLimit] = useState<QuestionLimit>('5');
  const [documentStats, setDocumentStats] = useState<DocumentReferenceStat[]>([]);
  const [keywordStats, setKeywordStats] = useState<KeywordStat[]>([]);
  const [topQuestions, setTopQuestions] = useState<TopQuestionStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoadedCourses, setHasLoadedCourses] = useState(false);

  const fetchCourses = useCallback(async () => {
    const { data, error } = await supabase
      .from('courses')
      .select('id, name, code')
      .order('name');

    if (error) {
      toast.error(error.message || 'Failed to load courses');
      setCourses([]);
      setSelectedCourseId('');
      setHasLoadedCourses(true);
      setIsLoading(false);
      return;
    }

    const nextCourses = (data || []) as Course[];
    setCourses(nextCourses);
    setSelectedCourseId((current) => current || nextCourses[0]?.id || '');
    setHasLoadedCourses(true);

    if (nextCourses.length === 0) {
      setIsLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async (refresh = false) => {
    if (!selectedCourseId) return;

    const startAt = timeWindowStartIso(timeWindow);

    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    const [documentResult, keywordResult, questionResult] = await Promise.all([
      supabase.rpc('get_course_document_reference_stats', {
        in_course_id: selectedCourseId,
        in_start_at: startAt,
      }),
      supabase.rpc('get_course_keyword_stats', {
        in_course_id: selectedCourseId,
        in_limit: 12,
        in_start_at: startAt,
      }),
      supabase.rpc('get_course_top_questions', {
        in_course_id: selectedCourseId,
        in_limit: Number(questionLimit),
        in_start_at: startAt,
      }),
    ]);

    if (documentResult.error || keywordResult.error || questionResult.error) {
      const message =
        documentResult.error?.message ||
        keywordResult.error?.message ||
        questionResult.error?.message ||
        'Failed to load analytics';
      toast.error(message);
    } else {
      setDocumentStats(documentResult.data || []);
      setKeywordStats(keywordResult.data || []);
      setTopQuestions(questionResult.data || []);
    }

    setIsRefreshing(false);
    setIsLoading(false);
  }, [questionLimit, selectedCourseId, timeWindow]);

  useEffect(() => {
    void fetchCourses();
  }, [fetchCourses]);

  useEffect(() => {
    if (!hasLoadedCourses || !selectedCourseId) return;
    void fetchAnalytics();
  }, [fetchAnalytics, hasLoadedCourses, selectedCourseId]);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) || null,
    [courses, selectedCourseId],
  );

  const summary = useMemo(() => {
    const referencedDocuments = documentStats.filter((item) => item.reference_count > 0).length;
    const totalReferences = documentStats.reduce((sum, item) => sum + item.reference_count, 0);

    return {
      totalDocuments: documentStats.length,
      referencedDocuments,
      totalReferences,
    };
  }, [documentStats]);

  return (
    <MainLayout showFooter={false}>
      <div className="container space-y-6 py-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Course Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Course-specific usage based on which materials the assistant actually cited in answers.
          </p>
        </div>

        <Card>
          <CardContent className="grid gap-3 pt-6 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Course</Label>
              <Select value={selectedCourseId} onValueChange={setSelectedCourseId} disabled={courses.length === 0}>
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
            </div>

            <div className="space-y-2">
              <Label>Time Window</Label>
              <Select value={timeWindow} onValueChange={(value) => setTimeWindow(value as TimeWindow)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Top Questions</Label>
              <Select value={questionLimit} onValueChange={(value) => setQuestionLimit(value as QuestionLimit)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">Top 5</SelectItem>
                  <SelectItem value="10">Top 10</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                onClick={() => void fetchAnalytics(true)}
                disabled={!selectedCourseId || isRefreshing}
                className="gap-2"
              >
                {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {!hasLoadedCourses || isLoading ? (
          <Card>
            <CardContent className="py-10">
              <div className="flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading analytics...
              </div>
            </CardContent>
          </Card>
        ) : courses.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No courses are available for analytics yet.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Documents In Course</CardDescription>
                  <CardTitle>{summary.totalDocuments}</CardTitle>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Documents Referenced</CardDescription>
                  <CardTitle>{summary.referencedDocuments}</CardTitle>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Citation References</CardDescription>
                  <CardTitle>{summary.totalReferences}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Document Usage</CardTitle>
                <CardDescription>
                  {selectedCourse ? `${selectedCourse.name}` : 'Selected course'} documents ranked by how often cited in answers.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Students Referring</TableHead>
                      <TableHead>Times Referenced</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documentStats.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                          No document analytics in this time window yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      documentStats.map((item) => (
                        <TableRow key={item.material_id}>
                          <TableCell className="max-w-[30rem]">
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
                                <FileText className="h-4 w-4" />
                              </div>
                              <div className="space-y-1">
                                <div className="font-medium">{item.file_name}</div>
                                <div className="text-xs text-muted-foreground">
                                  Last referenced: {formatDateTime(item.last_referenced_at)}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{formatFileType(item.file_type)}</Badge>
                          </TableCell>
                          <TableCell>{item.unique_student_count}</TableCell>
                          <TableCell>{item.reference_count}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <CardTitle>Frequent Keywords / Concepts</CardTitle>
                  </div>
                  <CardDescription>Common terms pulled from student questions in this course.</CardDescription>
                </CardHeader>
                <CardContent>
                  {keywordStats.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No repeated keywords yet for this course in the selected time window.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {keywordStats.map((item) => (
                        <Badge key={item.keyword} variant="secondary" className="gap-2 px-3 py-1">
                          <span>{item.keyword}</span>
                          <span className="text-xs text-muted-foreground">{item.frequency}</span>
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                    <CardTitle>Most Frequent Questions</CardTitle>
                  </div>
                  <CardDescription>Repeated questions asked by students in this course.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Question</TableHead>
                        <TableHead>Times Asked</TableHead>
                        <TableHead>Students</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topQuestions.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                            No repeated questions in this time window yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        topQuestions.map((item) => (
                          <TableRow key={`${item.question}-${item.last_asked_at}`}>
                            <TableCell className="max-w-[24rem]">
                              <div className="space-y-1">
                                <div className="line-clamp-2 font-medium">{item.question}</div>
                                <div className="text-xs text-muted-foreground">
                                  Last asked: {formatDateTime(item.last_asked_at)}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>{item.frequency}</TableCell>
                            <TableCell>{item.unique_student_count}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}
