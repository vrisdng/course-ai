import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

import { passwordSetupResponse } from '../_shared/passwordSetup.ts';
import {
  handleSubmitSurvey,
  jsonResponse,
  type SurveyAuthResult,
  type SurveySavePayload,
  type SubmitSurveyDeps,
} from '../_shared/surveyHandler.ts';
import type { SurveyAnswer } from '../_shared/survey.ts';

async function authenticate(req: Request): Promise<SurveyAuthResult> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server is not configured' }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const {
    data: { user },
    error,
  } = await adminClient.auth.getUser(authHeader.replace('Bearer ', ''));

  if (error || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const setupResponse = passwordSetupResponse(user);
  if (setupResponse) {
    return setupResponse;
  }

  return { userId: user.id };
}

async function saveSurvey(payload: SurveySavePayload): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Server is not configured');
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await adminClient
    .from('survey_responses')
    .insert({ user_id: payload.userId, answers: payload.answers as SurveyAnswer[] })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save survey: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error('Failed to save survey: no id returned');
  }

  return data.id;
}

const deps: SubmitSurveyDeps = {
  authenticate,
  save: saveSurvey,
};

serve((req: Request) => handleSubmitSurvey(req, deps));
