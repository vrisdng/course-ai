import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

interface RedeemInviteRequest {
  inviteCode: string;
}


serve(async (req: Request) => {
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

    // Service-role client for DB operations (bypasses RLS so students can read/update invites)
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Authenticate the user from their Bearer token
    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(authHeader.replace("Bearer ", ""));

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

    const { data: inviteRow, error: inviteError } = await adminClient
      .from("course_invites")
      .select("id, course_id, expires_at, redeemed_at, redeemed_by")
      .eq("invite_code", inviteCode)
      .eq("is_course_code", true)
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

    if (new Date(inviteRow.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: "Invite has expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const { data: enrollmentRow, error: enrollmentError } = await adminClient
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
      const { error: insertEnrollmentError } = await adminClient.from("enrollments").insert({
        user_id: user.id,
        course_id: inviteRow.course_id,
      });

      if (insertEnrollmentError) {
        throw new Error(`Failed to enroll user: ${insertEnrollmentError.message}`);
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
