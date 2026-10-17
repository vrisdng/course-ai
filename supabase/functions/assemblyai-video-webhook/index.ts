import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function equalSecret(actual: string, expected: string): boolean {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

interface WebhookPayload { transcript_id?: string; status?: string }

// The webhook only wakes a matching durable job. The authenticated reconciler
// fetches the actual transcript from AssemblyAI and publishes the index.
serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const secret = Deno.env.get("ASSEMBLYAI_WEBHOOK_SECRET") ?? "";
  if (!equalSecret(req.headers.get("x-assemblyai-webhook-secret") ?? "", secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const payload = await req.json() as WebhookPayload;
    if (!payload.transcript_id || !["completed", "error"].includes(payload.status ?? "")) {
      return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { error } = await admin.from("video_transcription_jobs")
      .update({ next_check_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("provider_transcript_id", payload.transcript_id).eq("status", "waiting");
    if (error) throw new Error(error.message);
    return Response.json({ received: true });
  } catch (error) {
    console.error("Video webhook failed", error);
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
});
