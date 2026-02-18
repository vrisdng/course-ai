import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface RedeemInviteRequest {
  inviteCode: string;
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

    const body = (await req.json()) as RedeemInviteRequest;
    const inviteCode = body.inviteCode?.trim();

    if (!inviteCode) {
      return new Response(JSON.stringify({ error: "inviteCode is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profileRow, error: profileError } = await supabaseClient
      .from("profiles")
      .select("email")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError || !profileRow?.email) {
      return new Response(JSON.stringify({ error: profileError?.message || "Profile not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inviteRow, error: inviteError } = await supabaseClient
      .from("course_invites")
      .select("id, course_id, invited_email, expires_at, redeemed_at, redeemed_by")
      .eq("invite_code", inviteCode)
      .maybeSingle();

    if (inviteError) {
      throw new Error(`Failed to load invite: ${inviteError.message}`);
    }

    if (!inviteRow) {
      return new Response(JSON.stringify({ error: "Invite not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nowIso = new Date().toISOString();
    if (new Date(inviteRow.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: "Invite has expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userEmail = normalizeEmail(profileRow.email);
    const inviteEmail = normalizeEmail(inviteRow.invited_email);

    if (userEmail !== inviteEmail) {
      return new Response(
        JSON.stringify({ error: "This invite was sent to a different email account" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (inviteRow.redeemed_at && inviteRow.redeemed_by && inviteRow.redeemed_by !== user.id) {
      return new Response(JSON.stringify({ error: "Invite has already been used" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: enrollmentRow, error: enrollmentError } = await supabaseClient
      .from("enrollments")
      .select("id")
      .eq("user_id", user.id)
      .eq("course_id", inviteRow.course_id)
      .maybeSingle();

    if (enrollmentError) {
      throw new Error(`Failed to check enrollment: ${enrollmentError.message}`);
    }

    const alreadyEnrolled = Boolean(enrollmentRow?.id);

    if (!alreadyEnrolled) {
      const { error: insertEnrollmentError } = await supabaseClient.from("enrollments").insert({
        user_id: user.id,
        course_id: inviteRow.course_id,
      });

      if (insertEnrollmentError) {
        throw new Error(`Failed to enroll user: ${insertEnrollmentError.message}`);
      }
    }

    if (!inviteRow.redeemed_at) {
      const { error: markRedeemedError } = await supabaseClient
        .from("course_invites")
        .update({ redeemed_at: nowIso, redeemed_by: user.id })
        .eq("id", inviteRow.id)
        .is("redeemed_at", null);

      if (markRedeemedError) {
        throw new Error(`Failed to mark invite as redeemed: ${markRedeemedError.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: alreadyEnrolled ? "already_enrolled" : "enrolled",
        courseId: inviteRow.course_id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("redeem-course-invite error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
