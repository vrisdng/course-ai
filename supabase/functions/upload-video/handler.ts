// Request handling for the legacy upload-video proxy (no longer called by the
// browser, which uploads through video-upload-session). Dependencies are
// passed in so the admission rules can be tested without Deno.
import { corsHeaders } from "../_shared/cors.ts";
import {
  UPLOAD_POLICY,
  UPLOAD_REJECTED_STATUS,
  checkVideoContentType,
  uploadRejectionBody,
  type UploadPolicy,
} from "../_shared/uploadPolicy.ts";

export type UploadVideoAuthorization = "admin" | "unauthorized" | "forbidden";

export type AssemblyUploadResult = { uploadUrl: string } | { error: string };

export interface UploadVideoDeps {
  assemblyConfigured: boolean;
  authorize(authHeader: string): Promise<UploadVideoAuthorization>;
  // Streams the body to AssemblyAI's upload endpoint.
  forwardToAssembly(body: ReadableStream<Uint8Array> | null, contentType: string): Promise<AssemblyUploadResult>;
  policy?: UploadPolicy;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleUploadVideo(req: Request, deps: UploadVideoDeps): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization header" }, 401);
    }
    if (!deps.assemblyConfigured) {
      return json({ error: "ASSEMBLY_API_KEY is not configured" }, 500);
    }

    const authorization = await deps.authorize(authHeader);
    if (authorization === "unauthorized") return json({ error: "Unauthorized" }, 401);
    if (authorization === "forbidden") return json({ error: "Forbidden" }, 403);

    // Only the declared type is available here; the bytes are not inspected.
    const decision = checkVideoContentType(req.headers.get("Content-Type"), deps.policy ?? UPLOAD_POLICY);
    if (!decision.allowed) {
      return json({ ...uploadRejectionBody(decision) }, UPLOAD_REJECTED_STATUS);
    }

    const result = await deps.forwardToAssembly(req.body, decision.contentType);
    if ("error" in result) {
      return json({ error: result.error }, 502);
    }
    return json({ uploadUrl: result.uploadUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[upload-video] Error:", error);
    return json({ error: message }, 500);
  }
}
