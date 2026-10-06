import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { processDueVideoJob } from "../transcribe-video/worker.ts";

// Schedule once per minute with the service role key in `apikey`. Each run
// advances one video, so no request waits for the provider to finish.
serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceRoleKey || req.headers.get("apikey") !== serviceRoleKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const assemblyApiKey = Deno.env.get("ASSEMBLY_API_KEY") ?? "";
  const openAiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!supabaseUrl || !assemblyApiKey || !openAiApiKey) {
    return Response.json({ error: "Video worker is not configured" }, { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);
  try {
    // Recover an upload that finished before its request could enqueue work.
    const { data: awaiting, error: awaitingError } = await admin.from("materials")
      .select("id").eq("file_type", "video")
      .eq("video_upload_state", "uploaded").eq("processing_status", "pending")
      .order("created_at").limit(10);
    if (awaitingError) throw new Error(awaitingError.message);
    for (const material of awaiting ?? []) {
      const { data: existing, error } = await admin.from("video_transcription_jobs")
        .select("status").eq("material_id", material.id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!existing || existing.status === "pending") {
        const response = await fetch(`${supabaseUrl}/functions/v1/transcribe-video`, {
          method: "POST", headers: {
            apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          }, body: JSON.stringify({ materialId: material.id }),
        });
        if (!response.ok) console.error("Unable to resume uploaded video", material.id, response.status);
        break;
      }
    }

    const { data: stale, error: staleError } = await admin.from("video_transcription_jobs")
      .update({ status: "submission_unknown", last_error: "Provider submission outcome is unknown; review before retrying", updated_at: new Date().toISOString() })
      .eq("status", "submitting").lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString())
      .select("material_id");
    if (staleError) throw new Error(staleError.message);
    for (const job of stale ?? []) {
      await admin.from("materials").update({
        processing_status: "failed", processing_stage: "failed",
        processing_error: "Provider submission outcome is unknown; review before retrying",
        processing_progress: null,
      }).eq("id", job.material_id);
    }
    const processed = await processDueVideoJob(admin, assemblyApiKey, openAiApiKey);
    return Response.json({ processed, submissionUnknown: stale?.length ?? 0 });
  } catch (error) {
    console.error("Video reconciliation failed", error);
    return Response.json({ error: "Video reconciliation failed" }, { status: 500 });
  }
});
