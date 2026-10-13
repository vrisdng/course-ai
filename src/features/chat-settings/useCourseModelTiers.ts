import { useEffect, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_CHAT_SETTINGS, resolveChatSettings, type ChatModelTier } from './chatSettingsForm';

export interface CourseModelTiers {
  allowedTiers: ChatModelTier[];
  defaultTier: ChatModelTier;
  // True once the course's settings were read (or failed to be).
  isLoaded: boolean;
}

const FALLBACK: CourseModelTiers = {
  allowedTiers: [...DEFAULT_CHAT_SETTINGS.allowedModelTiers],
  defaultTier: DEFAULT_CHAT_SETTINGS.defaultModelTier,
  isLoaded: false,
};

// The model tiers a course lets students pick, for the chat composer. rag-chat
// enforces the same rule, so falling back to every tier only affects the menu.
export function useCourseModelTiers(courseId: string | null): CourseModelTiers {
  const [tiers, setTiers] = useState<CourseModelTiers>(FALLBACK);

  useEffect(() => {
    setTiers(FALLBACK);
    if (!courseId) return;

    let cancelled = false;
    void supabase
      .from('course_chat_settings')
      .select('allowed_model_tiers, default_model_tier')
      .eq('course_id', courseId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        const settings = resolveChatSettings(error ? null : data);
        setTiers({ allowedTiers: settings.allowedModelTiers, defaultTier: settings.defaultModelTier, isLoaded: true });
      });

    return () => {
      cancelled = true;
    };
  }, [courseId]);

  return tiers;
}
