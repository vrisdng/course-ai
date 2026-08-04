import { withSupabase } from "npm:@supabase/server";

declare const EdgeRuntime:
  | { waitUntil?: (promise: Promise<unknown>) => void }
  | undefined;

interface ProcessingJob {
  material_id: string;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (_req, ctx) => {
    const { data: authData, error: authError } = await ctx.supabase.auth.getUser();
    if (authError || !authData.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await ctx.supabase
      .from("profiles")
      .select("role")
      .eq("user_id", authData.user.id)
      .single();

    if (profileError || profile?.role !== "admin") {
      return Response.json({ error: "Admin access required" }, { status: 403 });
    }

    const { data: reaped, error: reapError } = await ctx.supabaseAdmin.rpc(
      "reap_stale_material_jobs",
    );
    if (reapError) {
      return Response.json({ error: reapError.message }, { status: 500 });
    }

    const { data: failedJobs, error: failedJobsError } = await ctx.supabaseAdmin
      .from("material_processing_jobs")
      .select("material_id, last_error")
      .eq("status", "failed")
      .not("last_error", "is", null)
      .like("last_error", "%maximum retry%");
    if (failedJobsError) {
      return Response.json({ error: failedJobsError.message }, { status: 500 });
    }

    for (const failedJob of failedJobs ?? []) {
      await ctx.supabaseAdmin
        .from("materials")
        .update({
          processing_status: "failed",
          processing_error: failedJob.last_error,
          processing_stage: "failed",
          processing_progress: null,
        })
        .eq("id", failedJob.material_id)
        .eq("processing_status", "processing");
    }

    const { data: pendingJobs, error: pendingJobsError } = await ctx.supabaseAdmin
      .from("material_processing_jobs")
      .select("material_id")
      .eq("status", "pending")
      .order("created_at")
      .limit(5);
    if (pendingJobsError) {
      return Response.json({ error: pendingJobsError.message }, { status: 500 });
    }

    const jobs = (pendingJobs ?? []) as ProcessingJob[];
    for (const job of jobs) {
      const trigger = ctx.supabaseAdmin.functions
        .invoke("process-material-job", { body: { materialId: job.material_id } })
        .then(({ error }) => {
          if (error) console.error(`Failed to trigger worker for ${job.material_id}:`, error.message);
        });

      if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
        EdgeRuntime.waitUntil(trigger);
      }
    }

    return Response.json({
      reaped: Number(reaped ?? 0),
      triggeredWorkers: jobs.length,
      materialIds: jobs.map((job) => job.material_id),
    });
  }),
};
