import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const { user, profile, refreshProfile, isLoading } = useAuth();
  
  const [fullName, setFullName] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingResetCode, setIsSendingResetCode] = useState(false);
  
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
    } catch (error) {
      const message = (error as Error)?.message || "Failed to save profile";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPassword = async () => {
    const email = user?.email?.trim().toLowerCase();
    if (!email || isSendingResetCode) return;

    setIsSendingResetCode(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      navigate('/reset-password', { state: { email, requireRecoveryOtp: true, from: '/settings' } });
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to send a reset code');
    } finally {
      setIsSendingResetCode(false);
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
      <div className="mx-auto max-w-4xl py-6 px-4 sm:py-8">
        <h1 className="text-2xl font-bold mb-6 sm:text-3xl sm:mb-8">Settings</h1>
        
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="scrollbar-hide mb-6 flex w-full justify-start overflow-x-auto border-b rounded-none h-auto p-0 bg-transparent sm:mb-8">
            <TabsTrigger 
              value="profile"
              className="-mb-px shrink-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              Profile
            </TabsTrigger>
            <TabsTrigger 
              value="ai-preferences"
              className="-mb-px shrink-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
            >
              AI Preferences
            </TabsTrigger>
            <TabsTrigger 
              value="courses"
              className="-mb-px shrink-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
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
              <div className="space-y-2 border-t pt-4">
                <h2 className="text-sm font-medium">Reset password</h2>
                <p className="text-xs text-muted-foreground">We’ll email a recovery code to {user?.email}.</p>
                <Button variant="outline" onClick={handleResetPassword} disabled={isSendingResetCode || !user?.email}>
                  {isSendingResetCode && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Email me a reset code
                </Button>
              </div>
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
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
