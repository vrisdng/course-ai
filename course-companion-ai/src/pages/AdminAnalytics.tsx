import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';

type QueryEvent = {
  id: string;
  created_at: string;
  query_text: string;
  query_category: string;
  citation_hit: boolean;
  citation_count: number;
  unresolved: boolean;
  unresolved_reason: string | null;
  retrieved_chunk_count: number;
  course_id: string | null;
  academic_term_id: string | null;
};

type Course = {
  id: string;
  name: string;
  code: string | null;
};

type AcademicTerm = {
  id: string;
  label: string;
};

type TimeWindow = '7d' | '30d' | '90d';

const timeWindowStartIso = (window: TimeWindow) => {
  const now = new Date();
  const days = window === '7d' ? 7 : window === '30d' ? 30 : 90;
  now.setDate(now.getDate() - days);
  return now.toISOString();
};

export default function AdminAnalytics() {
  const [events, setEvents] = useState<QueryEvent[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('30d');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [termFilter, setTermFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchReferenceData = useCallback(async () => {
    const [{ data: coursesData, error: coursesError }, { data: termData, error: termError }] = await Promise.all([
      supabase.from('courses').select('id, name, code').order('name'),
      supabase.from('academic_terms').select('id, label').order('label'),
    ]);

    if (coursesError) {
      toast.error('Failed to load courses for analytics filters');
    } else {
      setCourses((coursesData || []) as Course[]);
    }

    if (termError) {
      toast.error('Failed to load academic terms for analytics filters');
    } else {
      setTerms((termData || []) as AcademicTerm[]);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setIsRefreshing(true);

    let query = supabase
      .from('query_events')
      .select('id, created_at, query_text, query_category, citation_hit, citation_count, unresolved, unresolved_reason, retrieved_chunk_count, course_id, academic_term_id')
      .gte('created_at', timeWindowStartIso(timeWindow))
      .order('created_at', { ascending: false })
      .limit(1000);

    if (courseFilter !== 'all') {
      query = query.eq('course_id', courseFilter);
    }

    if (termFilter !== 'all') {
      query = query.eq('academic_term_id', termFilter);
    }

    const { data, error } = await query;

    if (error) {
      toast.error(error.message || 'Failed to load analytics events');
    } else {
      setEvents((data || []) as QueryEvent[]);
    }

    setIsRefreshing(false);
  }, [courseFilter, termFilter, timeWindow]);

  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true);
      await fetchReferenceData();
      await fetchEvents();
      setIsLoading(false);
    };

    void initialize();
  }, [fetchEvents, fetchReferenceData]);

  const courseLabelById = useMemo(() => {
    return courses.reduce<Record<string, string>>((acc, course) => {
      acc[course.id] = `${course.name}${course.code ? ` (${course.code})` : ''}`;
      return acc;
    }, {});
  }, [courses]);

  const termLabelById = useMemo(() => {
    return terms.reduce<Record<string, string>>((acc, term) => {
      acc[term.id] = term.label;
      return acc;
    }, {});
  }, [terms]);

  const summary = useMemo(() => {
    const total = events.length;
    const citationHitCount = events.filter((event) => event.citation_hit).length;
    const unresolvedCount = events.filter((event) => event.unresolved).length;

    return {
      total,
      citationHitRate: total > 0 ? (citationHitCount / total) * 100 : 0,
      unresolvedRate: total > 0 ? (unresolvedCount / total) * 100 : 0,
      unresolvedCount,
    };
  }, [events]);

  const categoryStats = useMemo(() => {
    const map = new Map<string, { count: number; citationHits: number; unresolvedCount: number }>();

    for (const event of events) {
      const key = event.query_category || 'other';
      const current = map.get(key) || { count: 0, citationHits: 0, unresolvedCount: 0 };
      current.count += 1;
      if (event.citation_hit) current.citationHits += 1;
      if (event.unresolved) current.unresolvedCount += 1;
      map.set(key, current);
    }

    return Array.from(map.entries())
      .map(([category, stats]) => ({
        category,
        count: stats.count,
        citationHitRate: stats.count > 0 ? (stats.citationHits / stats.count) * 100 : 0,
        unresolvedCount: stats.unresolvedCount,
      }))
      .sort((a, b) => b.count - a.count);
  }, [events]);

  const unresolvedEvents = useMemo(() => {
    return events.filter((event) => event.unresolved).slice(0, 50);
  }, [events]);

  return (
    <MainLayout showFooter={false}>
      <div className="container py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Usage Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Admin-only analytics for query categories, citation hit-rates, and unresolved questions.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 grid gap-3 md:grid-cols-4">
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
              <Label>Course</Label>
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All courses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All courses</SelectItem>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name} {course.code ? `(${course.code})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Academic Term</Label>
              <Select value={termFilter} onValueChange={setTermFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All terms" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All terms</SelectItem>
                  {terms.map((term) => (
                    <SelectItem key={term.id} value={term.id}>
                      {term.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button onClick={() => void fetchEvents()} disabled={isRefreshing} className="gap-2">
                {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="py-10">
              <div className="flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading analytics...
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Queries</CardDescription>
                  <CardTitle>{summary.total}</CardTitle>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Citation Hit-Rate</CardDescription>
                  <CardTitle>{summary.citationHitRate.toFixed(1)}%</CardTitle>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Unresolved Queries</CardDescription>
                  <CardTitle>
                    {summary.unresolvedCount} ({summary.unresolvedRate.toFixed(1)}%)
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Query Categories</CardTitle>
                <CardDescription>Distribution and citation performance by category.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Queries</TableHead>
                      <TableHead>Citation Hit-Rate</TableHead>
                      <TableHead>Unresolved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryStats.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                          No events in this filter window.
                        </TableCell>
                      </TableRow>
                    ) : (
                      categoryStats.map((item) => (
                        <TableRow key={item.category}>
                          <TableCell className="font-medium">{item.category}</TableCell>
                          <TableCell>{item.count}</TableCell>
                          <TableCell>{item.citationHitRate.toFixed(1)}%</TableCell>
                          <TableCell>{item.unresolvedCount}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Unresolved Queries</CardTitle>
                <CardDescription>Latest unresolved queries for follow-up and content gap analysis.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Course</TableHead>
                      <TableHead>Term</TableHead>
                      <TableHead>Query</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unresolvedEvents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          No unresolved queries in this filter window.
                        </TableCell>
                      </TableRow>
                    ) : (
                      unresolvedEvents.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell>{new Date(event.created_at).toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{event.query_category}</Badge>
                          </TableCell>
                          <TableCell>{event.unresolved_reason || '-'}</TableCell>
                          <TableCell>{event.course_id ? courseLabelById[event.course_id] || 'Unknown course' : '-'}</TableCell>
                          <TableCell>{event.academic_term_id ? termLabelById[event.academic_term_id] || 'Unknown term' : '-'}</TableCell>
                          <TableCell className="max-w-[28rem] truncate">{event.query_text}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </MainLayout>
  );
}
