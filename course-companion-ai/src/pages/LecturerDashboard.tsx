import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useCourses } from '@/hooks/useCourses';
import { useMaterials } from '@/hooks/useMaterials';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MaterialUploadZone } from '@/components/lecturer/MaterialUploadZone';
import { UploadProgressList } from '@/components/lecturer/UploadProgressList';
import { MaterialsList } from '@/components/lecturer/MaterialsList';
import {
  Upload,
  FileText,
  Users,
  BarChart3,
  Plus,
  Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function LecturerDashboard() {
  const { profile } = useAuth();
  const { courses, selectedCourseId, setSelectedCourseId, isLoading: coursesLoading } = useCourses();
  const {
    materials,
    isLoading: materialsLoading,
    uploads,
    uploadFile,
    deleteMaterial,
    acceptedExtensions,
  } = useMaterials(selectedCourseId);

  const handleFilesSelected = (files: File[]) => {
    files.forEach((file) => uploadFile(file));
  };

  // Placeholder students and analytics — will be replaced with real data later
  const students = [
    { id: '1', name: 'Alice Johnson', email: 'alice@university.edu', questionsAsked: 15 },
    { id: '2', name: 'Bob Smith', email: 'bob@university.edu', questionsAsked: 8 },
    { id: '3', name: 'Carol Williams', email: 'carol@university.edu', questionsAsked: 23 },
  ];

  return (
    <MainLayout showFooter={false}>
      <div className="container py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Lecturer Dashboard</h1>
            <p className="text-muted-foreground">
              Manage course materials, students, and view analytics
            </p>
          </div>

          {/* Course selector */}
          {courses.length > 0 && (
            <Select value={selectedCourseId || ''} onValueChange={setSelectedCourseId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select course" />
              </SelectTrigger>
              <SelectContent>
                {courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.code ? `${course.code} — ` : ''}{course.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {coursesLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : courses.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <FileText className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="mb-2 text-lg font-medium text-foreground">No courses yet</p>
              <p className="mb-4 text-sm text-muted-foreground">
                Create a course to start uploading materials
              </p>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="materials" className="space-y-6">
            <TabsList>
              <TabsTrigger value="materials" className="gap-2">
                <FileText className="h-4 w-4" />
                Materials
              </TabsTrigger>
              <TabsTrigger value="students" className="gap-2">
                <Users className="h-4 w-4" />
                Students
              </TabsTrigger>
              <TabsTrigger value="analytics" className="gap-2">
                <BarChart3 className="h-4 w-4" />
                Analytics
              </TabsTrigger>
            </TabsList>

            {/* Materials Tab */}
            <TabsContent value="materials" className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Course Materials</h2>
                <p className="text-sm text-muted-foreground">
                  Upload documents for RAG retrieval — PDF, images, DOCX, PPTX supported
                </p>
              </div>

              <MaterialUploadZone
                onFilesSelected={handleFilesSelected}
                acceptedExtensions={acceptedExtensions}
                isDisabled={!selectedCourseId}
              />

              <UploadProgressList uploads={uploads} />

              {materialsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : materials.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Upload className="mb-4 h-12 w-12 text-muted-foreground/50" />
                    <p className="mb-2 text-lg font-medium text-foreground">No materials yet</p>
                    <p className="text-sm text-muted-foreground">
                      Drag & drop files above to enable AI-powered Q&A
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <MaterialsList materials={materials} onDelete={deleteMaterial} />
              )}
            </TabsContent>

            {/* Students Tab */}
            <TabsContent value="students" className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Enrolled Students</h2>
                  <p className="text-sm text-muted-foreground">
                    Manage student access to the course
                  </p>
                </div>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Student
                </Button>
              </div>

              <Card>
                <CardContent className="p-0">
                  <table className="w-full">
                    <thead className="border-b border-border bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Name</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Email</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Questions Asked</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {students.map((student) => (
                        <tr key={student.id}>
                          <td className="px-4 py-3 text-sm font-medium text-foreground">{student.name}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{student.email}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{student.questionsAsked}</td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Analytics Tab */}
            <TabsContent value="analytics" className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Usage Analytics</h2>
                <p className="text-sm text-muted-foreground">
                  Track how students interact with the course materials
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Questions</CardDescription>
                    <CardTitle className="text-3xl">247</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">+12% from last week</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Active Students</CardDescription>
                    <CardTitle className="text-3xl">18</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">Out of 24 enrolled</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Avg. Response Quality</CardDescription>
                    <CardTitle className="text-3xl">89%</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">Based on citation relevance</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Common Topics</CardTitle>
                  <CardDescription>Most frequently asked topics this week</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {[
                      { topic: 'Machine Learning Basics', count: 45, percentage: 75 },
                      { topic: 'Regression Analysis', count: 32, percentage: 53 },
                      { topic: 'Neural Networks', count: 28, percentage: 47 },
                      { topic: 'Data Preprocessing', count: 21, percentage: 35 },
                    ].map((item) => (
                      <div key={item.topic} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">{item.topic}</span>
                          <span className="text-muted-foreground">{item.count} questions</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-primary"
                            style={{ width: `${item.percentage}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </MainLayout>
  );
}
