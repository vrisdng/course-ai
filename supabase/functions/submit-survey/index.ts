import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

import { passwordSetupResponse } from '../_shared/passwordSetup.ts';
import {
  handleSubmitSurvey,
  jsonResponse,
  type SurveyAuthResult,
  type SurveyEmailMessage,
} from '../_shared/surveyHandler.ts';

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

async function sendEmail(message: SurveyEmailMessage): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend responded ${response.status}: ${detail}`);
  }
}

serve((req: Request) => handleSubmitSurvey(req, {
  authenticate,
  sendEmail,
  recipientEmail: Deno.env.get('SURVEY_RECIPIENT_EMAIL') ?? 'maidng@u.nus.edu',
  fromEmail: Deno.env.get('SURVEY_FROM_EMAIL') ?? 'CEEGPT Survey <onboarding@resend.dev>',
}));
