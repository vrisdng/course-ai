import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { BookOpen, Loader2 } from "lucide-react";

interface AccessibleCourse {
  id: string;
  name: string;
  code: string | null;
  accessRole: string;
}

export default function Settings() {
  const { profile, refreshProfile, isLoading, isAdmin } = useAuth();
  
  const [fullName, setFullName] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [enrollCode, setEnrollCode] = useState("");
  const [isEnrolling, setIsEnrolling] = useState(false);
  
  const [courses, setCourses] = useState<AccessibleCourse[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setCustomInstructions(profile.custom_instructions || "");
    }
  }, [profile]);

  useEffect(() => {
    const fetchCourses = async () => {
      const { data, error } = await supabase.rpc('list_accessible_courses');
      if (error) {
        console.error('Failed to load courses:', error);
      } else {
        setCourses(
          (data || []).map((course) => ({
            id: course.id,
            name: course.name,
            code: course.code,
            accessRole: course.access_role,
          }))
        );
      }
      setIsLoadingCourses(false);
    };

    fetchCourses();
  }, []);

  const handleSaveProfile = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          custom_instructions: customInstructions,
        })
        .eq("id", profile.id);

      if (error) throw error;
      await refreshProfile();
      toast.success("Profile saved successfully");
    } catch (error: any) {
      toast.error(error.message || "Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEnroll = async () => {
    if (!enrollCode.trim()) return;
    setIsEnrolling(true);
    try {
      const { data, error } = await supabase.functions.invoke('redeem-course-invite', {
        body: { inviteCode: enrollCode.trim().toUpperCase() },
      });

      if (error || data?.error) {
        throw new Error(error?.message || data?.error || 'Invalid or expired code');
      }

      await refreshProfile();
      // Refetch courses after enrolling
      const { data: updatedCourses, error: refetchError } = await supabase.rpc('list_accessible_courses');
      if (!refetchError && updatedCourses) {
        setCourses(
          updatedCourses.map((course) => ({
            id: course.id,
            name: course.name,
            code: course.code,
            accessRole: course.access_role,
          }))
        );
      }

      toast.success(
        data?.status === 'already_enrolled'
          ? 'You are already enrolled in this course.'
          : 'Successfully enrolled!'
      );
      setEnrollCode("");
    } catch (err: any) {
      toast.error(err.message || 'Failed to enroll');
    } finally {
      setIsEnrolling(false);
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="mx-auto max-w-4xl py-8 px-4">
        <h1 className="text-3xl font-bold mb-8">Settings</h1>
        
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="mb-8 w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
            <TabsTrigger 
              value="profile"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              Profile
            </TabsTrigger>
            <TabsTrigger 
              value="ai-preferences"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              AI Preferences
            </TabsTrigger>
            <TabsTrigger 
              value="courses"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              Courses
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-6">
            <div className="space-y-4 max-w-xl">
              <div className="space-y-2">
                <label className="text-sm font-medium">Email Address</label>
                <Input value={profile?.email || ""} disabled />
                <p className="text-xs text-muted-foreground">Your email address cannot be changed here.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Full Name (Username)</label>
                <Input 
                  value={fullName} 
                  onChange={(e) => setFullName(e.target.value)} 
                  placeholder="Enter your name" 
                />
              </div>
              <Button onClick={handleSaveProfile} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="ai-preferences" className="space-y-6">
            <div className="space-y-4 max-w-xl">
              <div className="space-y-2">
                <label className="text-sm font-medium">Custom Instructions</label>
                <Textarea 
                  value={customInstructions} 
                  onChange={(e) => setCustomInstructions(e.target.value)} 
                  placeholder="What would you like the AI to know about you to provide better responses? e.g. 'I'm a beginner at Python' or 'Always explain things simply.'"
                  className="min-h-[150px]"
                />
                <p className="text-xs text-muted-foreground">
                  These instructions will be given to the AI along with your prompt to personalize its responses.
                </p>
              </div>
              <Button onClick={handleSaveProfile} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Preferences
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="courses" className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Enrolled Courses</h3>
              {isLoadingCourses ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading courses...
                </div>
              ) : courses.length > 0 ? (
                <div className="grid gap-3">
                  {courses.map(course => (
                    <div key={course.id} className="flex items-center gap-3 p-3 border rounded-md bg-card">
                      <div className="bg-primary/10 p-2 rounded-full">
                        <BookOpen className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{course.name}</p>
                        {course.code && <p className="text-xs text-muted-foreground">{course.code}</p>}
                      </div>
                      <div className="text-xs capitalize text-muted-foreground bg-muted px-2 py-1 rounded-md">
                        {course.accessRole}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  You are not enrolled in any courses yet.
                </div>
              )}
              
              {!isAdmin && (
                <div className="mt-8 pt-6 border-t">
                  <h4 className="text-md font-medium mb-2">Enroll in a New Course</h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    Use your course invite code to gain access to a new course.
                  </p>
                  <div className="flex gap-2 max-w-md">
                    <Input 
                      placeholder="Course Invite Code" 
                      value={enrollCode}
                      onChange={(e) => setEnrollCode(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleEnroll()}
                    />
                    <Button onClick={handleEnroll} disabled={isEnrolling || !enrollCode.trim()}>
                      {isEnrolling ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enroll"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
