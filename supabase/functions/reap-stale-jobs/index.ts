import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime:
  | { waitUntil?: (promise: Promise<unknown>) => void }
  | undefined;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseKey);

    // 1. Run the stale-lock reaper (resets stale processing → pending, fails max-attempt jobs)
    const { data: reaped, error: reapError } = await adminClient.rpc(
      "reap_stale_material_jobs",
    );

    if (reapError) {
      console.error("Reaper error:", reapError.message);
    } else {
      console.log(`Reaped ${reaped ?? 0} stale job(s)`);
    }

    // 2. Also update materials table for any jobs that were marked failed by the reaper
    const { data: failedJobs } = await adminClient
      .from("material_processing_jobs")
      .select("material_id, last_error")
      .eq("status", "failed")
      .not("last_error", "is", null)
      .like("last_error", "%maximum retry%");

    if (failedJobs && failedJobs.length > 0) {
      for (const fj of failedJobs) {
        await adminClient
          .from("materials")
          .update({
            processing_status: "failed",
            processing_error: fj.last_error,
            processing_stage: "failed",
            processing_progress: null,
          })
          .eq("id", fj.material_id)
          .eq("processing_status", "processing");
      }
    }

    // 3. Trigger worker for any pending jobs (including freshly-reaped ones)
    const { data: pendingJobs } = await adminClient
      .from("material_processing_jobs")
      .select("material_id")
      .eq("status", "pending")
      .order("created_at")
      .limit(5);

    const triggered: string[] = [];

    if (pendingJobs && pendingJobs.length > 0) {
      for (const pj of pendingJobs) {
        const trigger = fetch(`${supabaseUrl}/functions/v1/process-material-job`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ materialId: pj.material_id }),
        }).catch((err) => {
          console.error(`Failed to trigger worker for ${pj.material_id}:`, err);
        });

        if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
          EdgeRuntime.waitUntil(trigger);
        } else {
          void trigger;
        }

        triggered.push(pj.material_id);
      }
    }

    return new Response(
      JSON.stringify({
        reaped: reaped ?? 0,
        triggeredWorkers: triggered.length,
        materialIds: triggered,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("reap-stale-jobs error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
