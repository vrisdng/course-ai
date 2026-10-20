import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { resolveChatSettings, toSettingsRow, type ChatSettings } from './chatSettingsForm';

export interface CourseChatSettingsState {
  settings: ChatSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  loadError: string | null;
  save: (settings: ChatSettings) => Promise<boolean>;
}

// Loads and saves one course's chat settings for the admin dashboard.
export function useCourseChatSettings(courseId: string | null, userId: string | undefined): CourseChatSettingsState {
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setSettings(null);
    setLoadError(null);
    if (!courseId) return;

    let cancelled = false;
    setIsLoading(true);
    void supabase
      .from('course_chat_settings')
      .select('*')
      .eq('course_id', courseId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoadError(error.message);
        } else {
          setSettings(resolveChatSettings(data));
        }
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const save = useCallback(async (next: ChatSettings): Promise<boolean> => {
    if (!courseId) return false;
    setIsSaving(true);
    const { data, error } = await supabase
      .from('course_chat_settings')
      .upsert({ course_id: courseId, ...toSettingsRow(next), updated_by: userId ?? null }, { onConflict: 'course_id' })
      .select('*')
      .single();
    setIsSaving(false);

    if (error) {
      toast.error(`Could not save chat settings: ${error.message}`);
      return false;
    }
    setSettings(resolveChatSettings(data));
    toast.success('Chat settings saved');
    return true;
  }, [courseId, userId]);

  return { settings, isLoading, isSaving, loadError, save };
}
