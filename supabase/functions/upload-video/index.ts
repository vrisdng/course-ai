import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleUploadVideo, type AssemblyUploadResult, type UploadVideoAuthorization } from "./handler.ts";

const ASSEMBLYAI_UPLOAD_URL = "https://api.assemblyai.com/v2/upload";

serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const assemblyApiKey = Deno.env.get("ASSEMBLY_API_KEY");

  return handleUploadVideo(req, {
    assemblyConfigured: Boolean(assemblyApiKey),

    async authorize(authHeader: string): Promise<UploadVideoAuthorization> {
      const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      if (userError || !user) return "unauthorized";

      const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();
      return profileError || !profile || profile.role !== "admin" ? "forbidden" : "admin";
    },

    // Stream the request body directly to AssemblyAI
    async forwardToAssembly(body, contentType): Promise<AssemblyUploadResult> {
      const assemblyResponse = await fetch(ASSEMBLYAI_UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: assemblyApiKey!,
          "Content-Type": contentType,
          "Transfer-Encoding": "chunked",
        },
        body,
        // @ts-expect-error — Deno requires duplex for streaming request bodies
        duplex: "half",
      });

      if (!assemblyResponse.ok) {
        const errorText = await assemblyResponse.text();
        return { error: `AssemblyAI upload failed: ${assemblyResponse.status} - ${errorText}` };
      }

      const payload = await assemblyResponse.json();
      if (!payload.upload_url) {
        return { error: "AssemblyAI did not return an upload URL" };
      }
      return { uploadUrl: payload.upload_url };
    },
  });
});
