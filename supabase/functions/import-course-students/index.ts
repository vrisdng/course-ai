import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleStudentImport, type StudentImportStore } from '../_shared/studentImport.ts';

serve(async (req: Request) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const store: StudentImportStore = {
    async authenticate(token) {
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (error || !user) return null;
      const { data: profile, error: profileError } = await admin.from('profiles').select('role').eq('user_id', user.id).single();
      if (profileError) throw profileError;
      return { role: profile.role, mustChangePassword: user.app_metadata?.must_change_password === true };
    },
    async courseExists(id) {
      // Fail closed if the password-enforcement migration has not been deployed.
      const { error: setupError } = await admin.rpc('require_password_setup');
      if (setupError) throw setupError;
      const { data, error } = await admin.from('courses').select('id').eq('id', id).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async findProfile(email) {
      const { data, error } = await admin.rpc('find_student_import_profile', { p_email: email }).maybeSingle();
      if (error) throw error;
      return data ? { userId: data.user_id, role: data.role } : null;
    },
    async createStudent(attributes) {
      const { data, error } = await admin.auth.admin.createUser(attributes);
      if (error || !data.user) throw error ?? new Error('Account creation failed');
      return data.user.id;
    },
    async enroll(userId, courseId) {
      const { data, error } = await admin.from('enrollments').upsert({ user_id: userId, course_id: courseId }, {
        onConflict: 'user_id,course_id', ignoreDuplicates: true,
      }).select('id');
      if (error) throw error;
      return data?.length ? 'enrolled' : 'already_enrolled';
    },
  };
  return handleStudentImport(req, store);
});
