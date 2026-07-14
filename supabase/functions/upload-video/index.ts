import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

const ASSEMBLYAI_UPLOAD_URL = "https://api.assemblyai.com/v2/upload";

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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const assemblyApiKey = Deno.env.get("ASSEMBLY_API_KEY");

    if (!assemblyApiKey) {
      return new Response(
        JSON.stringify({ error: "ASSEMBLY_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth check
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream the request body directly to AssemblyAI
    const contentType = req.headers.get("Content-Type") || "application/octet-stream";

    const assemblyResponse = await fetch(ASSEMBLYAI_UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: assemblyApiKey,
        "Content-Type": contentType,
        "Transfer-Encoding": "chunked",
      },
      body: req.body,
      // @ts-ignore — Deno requires duplex for streaming request bodies
      duplex: "half",
    });

    if (!assemblyResponse.ok) {
      const errorText = await assemblyResponse.text();
      return new Response(
        JSON.stringify({ error: `AssemblyAI upload failed: ${assemblyResponse.status} - ${errorText}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = await assemblyResponse.json();

    if (!payload.upload_url) {
      return new Response(
        JSON.stringify({ error: "AssemblyAI did not return an upload URL" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ uploadUrl: payload.upload_url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[upload-video] Error:", error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
