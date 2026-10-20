import { corsHeaders } from './cors.ts';

// Call only with a user returned by auth.getUser, not decoded client claims.
export function passwordSetupResponse(user: { app_metadata?: Record<string, unknown> }): Response | null {
  return user.app_metadata?.must_change_password === true
    ? new Response(JSON.stringify({ error: 'Choose a new password before accessing the app' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }) : null;
}
