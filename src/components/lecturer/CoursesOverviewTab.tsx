import { Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Course } from '@/pages/AdminDashboard';

type AcademicTerm = {
  id: string;
  label: string;
  semester: number;
  academic_year_start: number;
  academic_year_end: number;
  sort_key: number;
  is_active: boolean;
};

interface CoursesOverviewTabProps {
  isAdmin: boolean;
  courses: Course[];
  isLoadingCourses: boolean;
  enrollmentCodeByCourseId: Record<string, string>;
  newCourseName: string;
  newCourseCode: string;
  newCourseDescription: string;
  isCreatingCourse: boolean;
  onNewCourseNameChange: (value: string) => void;
  onNewCourseCodeChange: (value: string) => void;
  onNewCourseDescriptionChange: (value: string) => void;
  onCreateCourse: () => void;
  onOpenAddStudentsDialog: (course: Course) => void;
  academicTerms: AcademicTerm[];
  isLoadingTerms: boolean;
  newTermSemester: '1' | '2';
  newTermAyStart: string;
  isCreatingTerm: boolean;
  activatingTermId: string | null;
  onNewTermSemesterChange: (value: '1' | '2') => void;
  onNewTermAyStartChange: (value: string) => void;
  onCreateAcademicTerm: () => void;
  onSetActiveTerm: (termId: string) => void;
}

export function CoursesOverviewTab({
  isAdmin,
  courses,
  isLoadingCourses,
  enrollmentCodeByCourseId,
  newCourseName,
  newCourseCode,
  newCourseDescription,
  isCreatingCourse,
  onNewCourseNameChange,
  onNewCourseCodeChange,
  onNewCourseDescriptionChange,
  onCreateCourse,
  onOpenAddStudentsDialog,
  academicTerms,
  isLoadingTerms,
  newTermSemester,
  newTermAyStart,
  isCreatingTerm,
  activatingTermId,
  onNewTermSemesterChange,
  onNewTermAyStartChange,
  onCreateAcademicTerm,
  onSetActiveTerm,
}: CoursesOverviewTabProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Course Setup</CardTitle>
          <CardDescription>Create a course before uploading documents.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="course-name">Course Name</Label>
            <Input
              id="course-name"
              value={newCourseName}
              onChange={(event) => onNewCourseNameChange(event.target.value)}
              placeholder="e.g. Intro to ML"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="course-code">Course Code (optional)</Label>
            <Input
              id="course-code"
              value={newCourseCode}
              onChange={(event) => onNewCourseCodeChange(event.target.value)}
              placeholder="e.g. CS101"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="course-description">Description (optional)</Label>
            <Input
              id="course-description"
              value={newCourseDescription}
              onChange={(event) => onNewCourseDescriptionChange(event.target.value)}
              placeholder="Short description"
            />
          </div>

          <div className="md:col-span-3">
            <Button onClick={onCreateCourse} disabled={isCreatingCourse} className="gap-2">
              {isCreatingCourse && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Course
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Created Courses</CardTitle>
          <CardDescription>All courses currently available for document uploads.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Course Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Enrollment Code</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingCourses ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading courses...
                    </div>
                  </TableCell>
                </TableRow>
              ) : courses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    No courses created yet.
                  </TableCell>
                </TableRow>
              ) : (
                courses.map((course) => (
                  <TableRow key={course.id}>
                    <TableCell className="font-medium">{course.name}</TableCell>
                    <TableCell>{course.code || '-'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{enrollmentCodeByCourseId[course.id] ?? 'N/A'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button type="button" size="sm" variant="outline" onClick={() => onOpenAddStudentsDialog(course)}>
                          Generate Code
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

      <Card>
        <CardHeader>
          <CardTitle>Academic Terms</CardTitle>
          <CardDescription>
            The active term is used for retrieval automatically. Assign upload files to the right term.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="term-semester">Semester</Label>
                <Select value={newTermSemester} onValueChange={(value) => onNewTermSemesterChange(value as '1' | '2')}>
                  <SelectTrigger id="term-semester">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Semester 1</SelectItem>
                    <SelectItem value="2">Semester 2</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="term-ay-start">AY Start Year</Label>
                <Input
                  id="term-ay-start"
                  inputMode="numeric"
                  value={newTermAyStart}
                  onChange={(event) => onNewTermAyStartChange(event.target.value)}
                  placeholder="2026"
                />
              </div>

              <div className="sm:col-span-2 flex items-end">
                <Button onClick={onCreateAcademicTerm} disabled={isCreatingTerm} className="gap-2">
                  {isCreatingTerm && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Academic Term
                </Button>
              </div>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Term</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingTerms ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading academic terms...
                    </div>
                  </TableCell>
                </TableRow>
              ) : academicTerms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                    No academic terms configured.
                  </TableCell>
                </TableRow>
              ) : (
                academicTerms.map((term) => (
                  <TableRow key={term.id}>
                    <TableCell className="font-medium">{term.label}</TableCell>
                    <TableCell>
                      {term.is_active ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {isAdmin ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={term.is_active ? 'secondary' : 'outline'}
                            disabled={term.is_active || activatingTermId === term.id}
                            onClick={() => onSetActiveTerm(term.id)}
                          >
                            {activatingTermId === term.id ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Activating...
                              </>
                            ) : term.is_active ? (
                              'Active'
                            ) : (
                              'Set Active'
                            )}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Admin only</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
