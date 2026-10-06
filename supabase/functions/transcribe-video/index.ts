import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { isStoredVideoPath } from "./pipeline.ts";

interface TranscribeRequest { materialId: string; refinalize?: boolean; retry?: boolean }
const MAX_VIDEO_BYTES = 3_000_000_000;
const SOURCE_URL_TTL_SECONDS = 6 * 60 * 60;
const VIDEO_BUCKET = "course-materials";
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const assemblyApiKey = Deno.env.get("ASSEMBLY_API_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey || !assemblyApiKey) return json({ error: "Video transcription is not configured" }, 500);
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const internal = req.headers.get("apikey") === serviceRoleKey ||
      req.headers.get("Authorization") === `Bearer ${serviceRoleKey}`;
    if (!internal) {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
      const { data: authData, error: authError } = await userClient.auth.getUser(authHeader.slice(7));
      if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);
      const { data: profile, error: profileError } = await userClient.from("profiles").select("role").eq("user_id", authData.user.id).single();
      if (profileError || profile?.role !== "admin") return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json() as TranscribeRequest;
    if (!body?.materialId || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(body.materialId)) return json({ error: "Valid materialId is required" }, 400);
    const { data: material, error: materialError } = await admin.from("materials")
      .select("id,file_type,file_path,file_size,video_upload_state,processing_status,duration_ms,transcription_language")
      .eq("id", body.materialId).maybeSingle();
    if (materialError) throw new Error(materialError.message);
    if (!material || material.file_type !== "video") return json({ error: "Video material not found" }, 404);

    if (body.refinalize === true) {
      if (!Deno.env.get("OPENAI_API_KEY")) return json({ error: "Embedding service is not configured" }, 500);
      const { data: existingJob } = await admin.from("video_transcription_jobs").select("status").eq("material_id", body.materialId).maybeSingle();
      if (existingJob?.status === "staging" || existingJob?.status === "indexing") return json({ success: true, queued: true, mode: "refinalize", materialId: body.materialId });
      if (existingJob?.status === "waiting" || existingJob?.status === "submitting") return json({ error: "Transcription is still running" }, 409);
      const { data: firstSegment, error: segmentError } = await admin.from("material_transcript_segments")
        .select("segment_index").eq("material_id", body.materialId).limit(1);
      if (segmentError) throw new Error(segmentError.message);
      if (!firstSegment?.length) return json({ error: "No transcript to reindex" }, 409);
      const { error: jobError } = await admin.from("video_transcription_jobs").upsert({
        material_id: body.materialId, status: "staging", attempt_count: 0,
        stage_source: "existing", stage_segment_cursor: 0, stage_chunk_cursor: 0,
        next_check_at: new Date().toISOString(), locked_until: null, last_error: null,
      }, { onConflict: "material_id" });
      if (jobError) throw new Error(jobError.message);
      return json({ success: true, queued: true, mode: "refinalize", materialId: body.materialId });
    }

    if (material.video_upload_state !== "uploaded" || !isStoredVideoPath(material.file_path)) return json({ error: "Stored video is not ready" }, 409);
    const pathParts = material.file_path.split("/");
    const filename = pathParts.pop()!;
    const { data: files, error: listError } = await admin.storage.from(VIDEO_BUCKET).list(pathParts.join("/"), { search: filename, limit: 100 });
    if (listError) throw new Error(listError.message);
    const storedFile = files?.find((file) => file.name === filename);
    const storedSize = Number(storedFile?.metadata?.size);
    if (!storedFile || !Number.isFinite(storedSize) || storedSize <= 0 || storedSize > MAX_VIDEO_BYTES || storedSize !== Number(material.file_size)) {
      return json({ error: "Stored video is missing, incomplete, or exceeds the 3 GB limit" }, 409);
    }
    if (body.retry === true) {
      const { data: reset, error: resetError } = await admin.rpc("retry_failed_video_transcription", { p_material_id: body.materialId });
      if (resetError) throw new Error(resetError.message);
      if (!reset) return json({ error: "Only a known failed transcription can be retried" }, 409);
    }
    const { data: signed, error: signError } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(material.file_path, SOURCE_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) throw new Error(signError?.message ?? "Unable to sign stored video");
    const { data: claimed, error: claimError } = await admin.rpc("claim_video_transcription_submission", { p_material_id: body.materialId });
    if (claimError) throw new Error(claimError.message);
    const claim = claimed?.[0];
    if (!claim?.claimed) {
      if (claim?.current_status === "failed") return json({ error: "Transcription failed; retry explicitly", status: "failed", materialId: body.materialId }, 409);
      if (claim?.current_status === "submission_unknown") return json({ error: "Provider submission outcome requires manual review", status: "submission_unknown", materialId: body.materialId }, 409);
      return json({ success: true, queued: claim?.current_status !== "completed", status: claim?.current_status, materialId: body.materialId });
    }
    const webhookSecret = Deno.env.get("ASSEMBLYAI_WEBHOOK_SECRET");
    const webhookUrl = Deno.env.get("ASSEMBLYAI_VIDEO_WEBHOOK_URL");
    const response = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST", headers: { Authorization: assemblyApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_url: signed.signedUrl, speech_models: ["universal-2"],
        ...(webhookSecret && webhookUrl ? {
          webhook_url: webhookUrl, webhook_auth_header_name: "x-assemblyai-webhook-secret",
          webhook_auth_header_value: webhookSecret,
        } : {}),
      }),
    });
    if (!response.ok) {
      const message = `AssemblyAI submission failed (${response.status})`;
      await admin.from("video_transcription_jobs").update({ status: "failed", last_error: message, updated_at: new Date().toISOString() }).eq("material_id", body.materialId);
      await admin.from("materials").update({ processing_status: "failed", processing_stage: "failed", processing_progress: null, processing_error: message }).eq("id", body.materialId);
      return json({ error: message }, 502);
    }
    const payload = await response.json() as { id?: string };
    if (!payload.id) throw new Error("AssemblyAI returned no transcript ID");
    const { error: recordError } = await admin.rpc("record_video_transcription_submission", { p_material_id: body.materialId, p_transcript_id: payload.id });
    if (recordError) throw new Error(recordError.message);
    return json({ success: true, queued: true, status: "waiting", materialId: body.materialId });
  } catch (error) {
    console.error("Video transcription request failed", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
