import { withSupabase } from "npm:@supabase/server";

declare const EdgeRuntime:
  | { waitUntil?: (promise: Promise<unknown>) => void }
  | undefined;

interface ProcessingJob {
  material_id: string;
}

interface UnqueuedPdfMaterial {
  id: string;
  file_path: string;
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

    // Older browser uploads set a PDF to processing before parse-document had
    // durably created its job. Recreate only that missing job; upsert keeps a
    // concurrent recovery from scheduling duplicate workers.
    const { data: unqueuedMaterials, error: unqueuedMaterialsError } = await ctx.supabaseAdmin
      .from("materials")
      .select("id, file_path, material_processing_jobs()")
      .eq("processing_status", "processing")
      .eq("file_type", "pdf")
      .is("material_processing_jobs", null)
      .order("created_at")
      .limit(5);
    if (unqueuedMaterialsError) {
      return Response.json({ error: unqueuedMaterialsError.message }, { status: 500 });
    }

    for (const material of (unqueuedMaterials ?? []) as UnqueuedPdfMaterial[]) {
      const { error: enqueueError } = await ctx.supabaseAdmin
        .from("material_processing_jobs")
        .upsert(
          {
            material_id: material.id,
            job_type: "parse_document",
            status: "pending",
            attempt_count: 0,
            last_error: null,
            locked_at: null,
            locked_by: null,
            payload: { filePath: material.file_path, fileType: "pdf", bucketName: "course-materials" },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "material_id,job_type", ignoreDuplicates: true },
        );
      if (enqueueError) {
        return Response.json({ error: enqueueError.message }, { status: 500 });
      }

      const { error: markQueuedError } = await ctx.supabaseAdmin
        .from("materials")
        .update({ processing_stage: "queueing", processing_progress: 10, processing_error: null })
        .eq("id", material.id);
      if (markQueuedError) {
        return Response.json({ error: markQueuedError.message }, { status: 500 });
      }
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
      recoveredUnqueuedMaterials: unqueuedMaterials?.length ?? 0,
      triggeredWorkers: jobs.length,
      materialIds: jobs.map((job) => job.material_id),
    });
  }),
};
