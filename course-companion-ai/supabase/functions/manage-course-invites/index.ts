import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_INVITES_PER_REQUEST = 200;
const INVITE_TTL_DAYS = 30;

interface InviteRequest {
  courseId: string;
  emails: string[];
}

interface InviteResult {
  email: string;
  status: "created" | "existing_invite" | "already_enrolled" | "invalid_email";
  inviteCode: string | null;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as InviteRequest;
    const courseId = body.courseId?.trim();
    const emails = Array.isArray(body.emails) ? body.emails : [];

    if (!courseId) {
      return new Response(JSON.stringify({ error: "courseId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (emails.length === 0) {
      return new Response(JSON.stringify({ error: "At least one email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmails = Array.from(
      new Set(emails.map(normalizeEmail).filter((email) => email.length > 0))
    ).slice(0, MAX_INVITES_PER_REQUEST);

    const { data: canManage, error: canManageError } = await supabaseClient.rpc("is_course_lecturer", {
      check_user_id: user.id,
      check_course_id: courseId,
    });

    if (canManageError) {
      throw new Error(`Failed to verify permissions: ${canManageError.message}`);
    }

    if (!canManage) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: actorProfile, error: actorError } = await supabaseClient
      .from("profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (actorError) {
      throw new Error(`Failed to load profile: ${actorError.message}`);
    }

    const actorProfileId = actorProfile?.id || null;
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const results: InviteResult[] = [];

    for (const email of normalizedEmails) {
      if (!EMAIL_REGEX.test(email)) {
        results.push({ email, status: "invalid_email", inviteCode: null });
        continue;
      }

      const { data: existingProfile } = await supabaseClient
        .from("profiles")
        .select("user_id")
        .ilike("email", email)
        .maybeSingle();

      if (existingProfile?.user_id) {
        const { data: enrollmentRow } = await supabaseClient
          .from("enrollments")
          .select("id")
          .eq("user_id", existingProfile.user_id)
          .eq("course_id", courseId)
          .maybeSingle();

        if (enrollmentRow?.id) {
          results.push({ email, status: "already_enrolled", inviteCode: null });
          continue;
        }
      }

      const { data: existingInvite } = await supabaseClient
        .from("course_invites")
        .select("invite_code")
        .eq("course_id", courseId)
        .eq("invited_email", email)
        .is("redeemed_at", null)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false })
        .maybeSingle();

      if (existingInvite?.invite_code) {
        results.push({ email, status: "existing_invite", inviteCode: existingInvite.invite_code });
        continue;
      }

      const inviteCode = crypto.randomUUID().replace(/-/g, "");
      const { error: insertError } = await supabaseClient.from("course_invites").insert({
        course_id: courseId,
        invited_email: email,
        invite_code: inviteCode,
        created_by: actorProfileId,
        expires_at: expiresAt,
      });

      if (insertError) {
        throw new Error(`Failed to create invite for ${email}: ${insertError.message}`);
      }

      results.push({ email, status: "created", inviteCode });
    }

    return new Response(
      JSON.stringify({
        success: true,
        expiresAt,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("manage-course-invites error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
