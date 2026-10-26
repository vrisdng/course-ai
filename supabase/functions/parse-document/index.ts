import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { readStoredObjectHead } from "../_shared/storageHead.ts";
import { handleParseDocument, type AuthorizationResult } from "./handler.ts";

declare const EdgeRuntime:
  | {
      waitUntil?: (promise: Promise<unknown>) => void;
    }
  | undefined;

serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, supabaseKey);

  return handleParseDocument(req, {
    async authorize(authHeader: string): Promise<AuthorizationResult> {
      const supabaseClient = createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
        error: userError,
      } = await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));
      if (userError || !user) return "unauthorized";

      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();
      return profile?.role === "admin" ? "admin" : "forbidden";
    },

    async findMaterial(id: string) {
      const { data: material, error } = await adminClient
        .from("materials")
        .select("id, file_name, file_path, processing_status")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`Failed to load material: ${error.message}`);
      if (!material) return null;

      const { data: job, error: jobError } = await adminClient
        .from("material_processing_jobs")
        .select("id")
        .eq("material_id", id)
        .eq("job_type", "parse_document")
        .maybeSingle();
      if (jobError) throw new Error(`Failed to load processing job: ${jobError.message}`);

      return {
        id: material.id,
        fileName: material.file_name,
        filePath: material.file_path,
        processingStatus: material.processing_status,
        hasProcessingJob: Boolean(job),
      };
    },

    readObjectHead(bucket: string, path: string) {
      return readStoredObjectHead({ supabaseUrl, serviceKey: supabaseKey, bucket, path });
    },

    async rejectMaterial(id: string, message: string) {
      const { error } = await adminClient
        .from("materials")
        .update({
          processing_status: "failed",
          processing_error: message,
          processing_stage: "failed",
          processing_progress: null,
        })
        .eq("id", id);
      if (error) console.error("Failed to record upload rejection:", error.message);
    },

    async markQueued(id: string) {
      await adminClient
        .from("materials")
        .update({
          processing_status: "processing",
          processing_error: null,
          processing_stage: "queueing",
          processing_progress: 10,
        })
        .eq("id", id);
    },

    async enqueueJob(id, payload) {
      const { error: jobError } = await adminClient
        .from("material_processing_jobs")
        .upsert(
          {
            material_id: id,
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
    },

    triggerWorker(id: string) {
      const workerTrigger = fetch(`${supabaseUrl}/functions/v1/process-material-job`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ materialId: id }),
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
    },
  });
});
