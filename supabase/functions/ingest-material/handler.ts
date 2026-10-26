// Request handling for ingest-material, with its database and embedding work
// passed in so the admission rules can be tested without Deno. index.ts wires
// the real Supabase client and the chunk → embed → insert pipeline.
import { corsHeaders } from "../_shared/cors.ts";
import {
  UPLOAD_POLICY,
  UPLOAD_REJECTED_STATUS,
  checkUpload,
  uploadRejectionBody,
  type UploadPolicy,
} from "../_shared/uploadPolicy.ts";

export interface IngestRequest {
  materialId: string;
  text: string;
}

export interface IngestMaterialRecord {
  id: string;
  fileName: string;
  filePath: string;
  processingStatus: string | null;
}

export type IngestAuthorization = "admin" | "unauthorized" | "forbidden" | "error";

export interface IngestMaterialDeps {
  embeddingConfigured: boolean;
  authorize(authHeader: string): Promise<IngestAuthorization>;
  findMaterial(id: string): Promise<IngestMaterialRecord | null>;
  // Marks a refused new upload failed, with the reason teachers will see.
  rejectMaterial(id: string, message: string): Promise<void>;
  // Chunks, embeds and stores the text; returns the number of chunks. It
  // records its own failures on the material.
  ingest(materialId: string, text: string): Promise<number>;
  policy?: UploadPolicy;
}

export const MAX_TEXT_LENGTH = 500_000;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleIngestMaterial(req: Request, deps: IngestMaterialDeps): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization header" }, 401);
    }
    if (!deps.embeddingConfigured) {
      return json({ error: "Embedding service is not configured. Please add OPENAI_API_KEY secret." }, 500);
    }

    const authorization = await deps.authorize(authHeader);
    if (authorization === "unauthorized") return json({ error: "Unauthorized" }, 401);
    if (authorization === "error") return json({ error: "Unable to verify user role" }, 500);
    if (authorization === "forbidden") return json({ error: "Forbidden" }, 403);

    const { materialId, text } = await req.json() as IngestRequest;
    if (!materialId || !text) {
      return json({ error: "materialId and text are required" }, 400);
    }

    const material = await deps.findMaterial(materialId);
    if (!material) {
      return json({ error: "Material not found" }, 404);
    }

    const decision = checkUpload(
      { fileName: material.fileName, storagePath: material.filePath },
      deps.policy ?? UPLOAD_POLICY,
    );
    if (!decision.allowed) {
      // An already indexed material keeps its chunks and state.
      if (material.processingStatus !== "completed") {
        await deps.rejectMaterial(material.id, decision.message);
      }
      return json({ ...uploadRejectionBody(decision) }, UPLOAD_REJECTED_STATUS);
    }
    if (decision.pipeline !== "text") {
      return json({ error: "This material is not a text upload" }, 400);
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return json({ error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters` }, 413);
    }

    const inserted = await deps.ingest(materialId, text);
    return json({ inserted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    console.error("Ingest material error:", error);
    return json({ error: message }, 500);
  }
}
