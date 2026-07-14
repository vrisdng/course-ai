import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

const CODE_LENGTH = 8;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // unambiguous chars (no 0/O/1/I)
const INVITE_TTL_DAYS = 30;

function generateCode(): string {
  const array = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => CODE_CHARS[b % CODE_CHARS.length])
    .join("");
}

interface GenerateCourseCodeRequest {
  courseId: string;
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

    const { data: canManage, error: canManageError } = await supabaseClient.rpc("is_admin", {
      check_user_id: user.id,
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

    const body = (await req.json()) as GenerateCourseCodeRequest;
    const courseId = body.courseId?.trim();

    if (!courseId) {
      return new Response(JSON.stringify({ error: "courseId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: actorProfile } = await supabaseClient
      .from("profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    // Delete all previous course codes for this course before generating a new one
    const { error: deleteError } = await supabaseClient
      .from("course_invites")
      .delete()
      .eq("course_id", courseId)
      .eq("is_course_code", true);

    if (deleteError) {
      throw new Error(`Failed to clear previous course codes: ${deleteError.message}`);
    }

    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Try up to 5 times to generate a unique code
    let inviteCode = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCode();
      const { data: existing } = await supabaseClient
        .from("course_invites")
        .select("id")
        .eq("invite_code", candidate)
        .maybeSingle();

      if (!existing) {
        inviteCode = candidate;
        break;
      }
    }

    if (!inviteCode) {
      throw new Error("Failed to generate a unique course code. Please try again.");
    }

    const { error: insertError } = await supabaseClient.from("course_invites").insert({
      course_id: courseId,
      invited_email: null,
      invite_code: inviteCode,
      is_course_code: true,
      created_by: actorProfile?.id || null,
      expires_at: expiresAt,
    });

    if (insertError) {
      throw new Error(`Failed to create course code: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        inviteCode,
        expiresAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("generate-course-code error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
