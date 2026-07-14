import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizeEmail } from "../_shared/email.ts";

interface CheckInviteRequest {
  inviteCode: string;
  email?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const body = (await req.json()) as CheckInviteRequest;
    const inviteCode = body.inviteCode?.trim();

    if (!inviteCode) {
      return new Response(JSON.stringify({ error: "inviteCode is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inviteRow, error: inviteError } = await supabaseClient
      .from("course_invites")
      .select("id, course_id, invited_email, expires_at, redeemed_at")
      .eq("invite_code", inviteCode)
      .maybeSingle();

    if (inviteError) {
      throw new Error(`Failed to check invite: ${inviteError.message}`);
    }

    if (!inviteRow) {
      return new Response(
        JSON.stringify({
          valid: false,
          reason: "not_found",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: courseRow, error: courseError } = await supabaseClient
      .from("courses")
      .select("id, name, code")
      .eq("id", inviteRow.course_id)
      .maybeSingle();

    if (courseError) {
      throw new Error(`Failed to load course: ${courseError.message}`);
    }

    const now = Date.now();
    const expiresAtMs = new Date(inviteRow.expires_at).getTime();
    const isExpired = Number.isFinite(expiresAtMs) ? expiresAtMs < now : true;
    const isRedeemed = Boolean(inviteRow.redeemed_at);

    const response: Record<string, unknown> = {
      valid: !isExpired && !isRedeemed,
      reason: isRedeemed ? "redeemed" : isExpired ? "expired" : "ok",
      invitedEmail: inviteRow.invited_email,
      course: {
        id: courseRow?.id || inviteRow.course_id,
        name: courseRow?.name || "Course",
        code: courseRow?.code || null,
      },
      expiresAt: inviteRow.expires_at,
      redeemedAt: inviteRow.redeemed_at,
    };

    const inputEmail = body.email ? normalizeEmail(body.email) : "";
    if (inputEmail) {
      const emailMatchesInvite = inputEmail === normalizeEmail(inviteRow.invited_email);
      response.emailMatchesInvite = emailMatchesInvite;

      const { data: profileRow, error: profileError } = await supabaseClient
        .from("profiles")
        .select("user_id")
        .ilike("email", inputEmail)
        .maybeSingle();

      if (profileError) {
        throw new Error(`Failed to check account status: ${profileError.message}`);
      }

      const accountExists = Boolean(profileRow?.user_id);
      response.accountExists = accountExists;

      let alreadyEnrolled = false;
      if (profileRow?.user_id) {
        const { data: enrollmentRow, error: enrollmentError } = await supabaseClient
          .from("enrollments")
          .select("id")
          .eq("user_id", profileRow.user_id)
          .eq("course_id", inviteRow.course_id)
          .maybeSingle();

        if (enrollmentError) {
          throw new Error(`Failed to check enrollment status: ${enrollmentError.message}`);
        }

        alreadyEnrolled = Boolean(enrollmentRow?.id);
      }

      response.alreadyEnrolled = alreadyEnrolled;
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("check-course-invite error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
