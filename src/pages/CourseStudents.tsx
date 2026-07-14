import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';

interface RosterEntry {
  enrollmentId: string;
  name: string;
  email: string;
  enrolledAt: string;
}

export default function CourseStudents() {
  const { courseId } = useParams<{ courseId: string }>();

  const [courseName, setCourseName] = useState<string>('');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRemoving, setIsRemoving] = useState(false);

  const fetchRoster = useCallback(async () => {
    if (!courseId) return;
    setIsLoading(true);
    setSelectedIds(new Set());

    const [courseResult, enrollmentsResult] = await Promise.all([
      supabase.from('courses').select('name, code').eq('id', courseId).maybeSingle(),
      supabase
        .from('enrollments')
        .select('id, user_id, enrolled_at')
        .eq('course_id', courseId)
        .order('enrolled_at', { ascending: true }),
    ]);

    if (courseResult.data) {
      setCourseName(
        `${courseResult.data.name}${courseResult.data.code ? ` (${courseResult.data.code})` : ''}`
      );
    }

    if (enrollmentsResult.error) {
      toast.error(enrollmentsResult.error.message || 'Failed to load students');
      setIsLoading(false);
      return;
    }

    const enrollments = enrollmentsResult.data || [];
    const userIds = enrollments.map((e) => e.user_id);

    // enrollments has no PostgREST FK to profiles, so fetch profiles separately and merge.
    const profileByUserId = new Map<string, { full_name: string | null; email: string }>();
    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', userIds);

      if (profilesError) {
        toast.error(profilesError.message || 'Failed to load student details');
        setIsLoading(false);
        return;
      }

      for (const p of profiles || []) {
        profileByUserId.set(p.user_id, { full_name: p.full_name, email: p.email });
      }
    }

    setRoster(
      enrollments.map((e) => {
        const profile = profileByUserId.get(e.user_id);
        return {
          enrollmentId: e.id,
          name: profile?.full_name || '—',
          email: profile?.email || '—',
          enrolledAt: e.enrolled_at,
        };
      })
    );
    setIsLoading(false);
  }, [courseId]);

  useEffect(() => {
    void fetchRoster();
  }, [fetchRoster]);

  const filteredRoster = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
  }, [roster, searchQuery]);

  const allVisibleSelected =
    filteredRoster.length > 0 && filteredRoster.every((r) => selectedIds.has(r.enrollmentId));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredRoster.forEach((r) => next.delete(r.enrollmentId));
      } else {
        filteredRoster.forEach((r) => next.add(r.enrollmentId));
      }
      return next;
    });
  };

  const toggleSelect = (enrollmentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(enrollmentId)) {
        next.delete(enrollmentId);
      } else {
        next.add(enrollmentId);
      }
      return next;
    });
  };

  const unenroll = async (entries: RosterEntry[]) => {
    if (entries.length === 0) return;
    const label =
      entries.length === 1
        ? `${entries[0].name} (${entries[0].email})`
        : `${entries.length} students`;
    if (!window.confirm(`Un-enroll ${label} from this course? They lose access but keep their account and chat history.`)) {
      return;
    }

    setIsRemoving(true);
    const ids = entries.map((e) => e.enrollmentId);
    const { error } = await supabase.from('enrollments').delete().in('id', ids);
    setIsRemoving(false);

    if (error) {
      toast.error(error.message || 'Failed to un-enroll');
      return;
    }

    const removed = new Set(ids);
    setRoster((prev) => prev.filter((r) => !removed.has(r.enrollmentId)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    toast.success(entries.length === 1 ? 'Student un-enrolled' : `${entries.length} students un-enrolled`);
  };

  // Only act on selections that are currently visible, so bulk un-enroll can never
  // delete rows the search filter is hiding.
  const selectedEntries = filteredRoster.filter((r) => selectedIds.has(r.enrollmentId));

  return (
    <MainLayout showFooter={false}>
      <div className="container py-8">
        <Button variant="ghost" size="sm" className="mb-4 gap-2 text-muted-foreground" asChild>
          <Link to="/admin-dashboard">
            <ArrowLeft className="h-4 w-4" />
            Back to Courses
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Enrolled Students</CardTitle>
            <CardDescription>
              {courseName ? `Students enrolled in ${courseName}.` : 'Manage students enrolled in this course.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative sm:max-w-xs sm:flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-8"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {selectedEntries.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 text-destructive hover:text-destructive"
                  disabled={isRemoving}
                  onClick={() => void unenroll(selectedEntries)}
                >
                  {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Un-enroll {selectedEntries.length} selected
                </Button>
              )}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={toggleSelectAll}
                      disabled={filteredRoster.length === 0}
                      aria-label="Select all students"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading students...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredRoster.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      {searchQuery ? 'No students match your search.' : 'No students enrolled yet.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRoster.map((entry) => (
                    <TableRow key={entry.enrollmentId}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(entry.enrollmentId)}
                          onCheckedChange={() => toggleSelect(entry.enrollmentId)}
                          aria-label={`Select ${entry.name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{entry.name}</TableCell>
                      <TableCell className="text-muted-foreground">{entry.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(entry.enrolledAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={isRemoving}
                            onClick={() => void unenroll([entry])}
                            aria-label={`Un-enroll ${entry.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
