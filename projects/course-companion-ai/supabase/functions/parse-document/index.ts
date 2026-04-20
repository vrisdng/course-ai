import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ParseRequest {
  materialId: string;
  filePath: string;
  fileType: string;
  bucketName?: string;
}

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "doc",
  "docx",
  "pptx",
]);

declare const EdgeRuntime:
  | {
      waitUntil?: (promise: Promise<unknown>) => void;
    }
  | undefined;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseKey);

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (!profile || profile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden — admins only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { materialId, filePath, fileType, bucketName } =
      (await req.json()) as ParseRequest;

    if (!materialId || !filePath) {
      return new Response(
        JSON.stringify({ error: "materialId and filePath are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const extension = filePath.split(".").pop()?.toLowerCase() || fileType;
    if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
      return new Response(
        JSON.stringify({ error: `Unsupported file type: ${extension || "unknown"}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await adminClient
      .from("materials")
      .update({
        processing_status: "processing",
        processing_error: null,
        processing_stage: "queueing",
        processing_progress: 10,
      })
      .eq("id", materialId);

    const payload = {
      filePath,
      fileType: extension,
      bucketName: bucketName || "course-materials",
    };

    const { error: jobError } = await adminClient
      .from("material_processing_jobs")
      .upsert(
        {
          material_id: materialId,
          job_type: "parse_document",
          status: "pending",
          attempt_count: 0,
          last_error: null,
          locked_at: null,
          locked_by: null,
          payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "material_id,job_type" }
      );

    if (jobError) {
      throw new Error(`Failed to enqueue parse job: ${jobError.message}`);
    }

    const workerTrigger = fetch(`${supabaseUrl}/functions/v1/process-material-job`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ materialId }),
    }).then(async (response) => {
      if (!response.ok) {
        console.error("Failed to trigger process-material-job:", response.status, await response.text());
      }
    }).catch((error) => {
      console.error("Failed to schedule process-material-job:", error);
    });

    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      EdgeRuntime.waitUntil(workerTrigger);
    } else {
      void workerTrigger;
    }

    return new Response(
      JSON.stringify({
        queued: true,
        materialId,
        message: "Document queued for background processing.",
      }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    console.error("Parse document enqueue error:", message);

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
