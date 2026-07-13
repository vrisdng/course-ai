import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Course {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  created_at: string;
}

export function useCourses() {
  const { profile } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchCourses() {
      if (!profile) {
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('courses')
        .select('*')
        .eq('created_by', profile.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching courses:', error);
      } else {
        setCourses(data || []);
        if (data && data.length > 0 && !selectedCourseId) {
          setSelectedCourseId(data[0].id);
        }
      }
      setIsLoading(false);
    }

    fetchCourses();
  }, [profile]);

  return {
    courses,
    selectedCourseId,
    setSelectedCourseId,
    isLoading,
  };
}
