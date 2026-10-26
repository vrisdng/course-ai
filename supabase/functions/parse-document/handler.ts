// Request handling for parse-document, with its database, Storage and worker
// calls passed in so the admission rules can be tested without Deno.
// index.ts wires the real Supabase clients.
import { corsHeaders } from "../_shared/cors.ts";
import type { StoredObjectHead } from "../_shared/storageHead.ts";
import {
  UPLOAD_POLICY,
  UPLOAD_REJECTED_STATUS,
  checkUpload,
  checkUploadContents,
  uploadRejectionBody,
  type UploadDecision,
  type UploadPolicy,
} from "../_shared/uploadPolicy.ts";

export interface ParseRequest {
  materialId: string;
  filePath: string;
  // Ignored for admission: the type comes from the stored material.
  fileType?: string;
  bucketName?: string;
}

export interface ParseDocumentMaterial {
  id: string;
  fileName: string;
  filePath: string;
  processingStatus: string | null;
  // A parse job already exists, so this is not a new upload.
  hasProcessingJob: boolean;
}

export interface ParseJobPayload {
  filePath: string;
  fileType: string;
  bucketName: string;
}

export type AuthorizationResult = "admin" | "unauthorized" | "forbidden";

export interface ParseDocumentDeps {
  authorize(authHeader: string): Promise<AuthorizationResult>;
  findMaterial(id: string): Promise<ParseDocumentMaterial | null>;
  readObjectHead(bucket: string, path: string): Promise<StoredObjectHead | null>;
  // Marks a refused new upload failed, with the reason teachers will see.
  rejectMaterial(id: string, message: string): Promise<void>;
  markQueued(id: string): Promise<void>;
  enqueueJob(id: string, payload: ParseJobPayload): Promise<void>;
  triggerWorker(id: string): void;
  policy?: UploadPolicy;
}

const DEFAULT_BUCKET = "course-materials";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Only a fresh upload is marked failed. A material that is already indexed,
// or has a parse job of its own, keeps its state.
function isNewAdmission(material: ParseDocumentMaterial): boolean {
  return !material.hasProcessingJob && material.processingStatus !== "completed";
}

async function refuse(
  material: ParseDocumentMaterial,
  decision: Extract<UploadDecision, { allowed: false }>,
  deps: ParseDocumentDeps,
): Promise<Response> {
  if (isNewAdmission(material)) {
    await deps.rejectMaterial(material.id, decision.message);
  }
  return json({ ...uploadRejectionBody(decision) }, UPLOAD_REJECTED_STATUS);
}

export async function handleParseDocument(req: Request, deps: ParseDocumentDeps): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization header" }, 401);
    }
    const authorization = await deps.authorize(authHeader);
    if (authorization === "unauthorized") {
      return json({ error: "Unauthorized" }, 401);
    }
    if (authorization === "forbidden") {
      return json({ error: "Forbidden — admins only" }, 403);
    }

    const { materialId, filePath, bucketName } = (await req.json()) as ParseRequest;
    if (!materialId || !filePath) {
      return json({ error: "materialId and filePath are required" }, 400);
    }

    const material = await deps.findMaterial(materialId);
    if (!material) {
      return json({ error: "Material not found" }, 404);
    }
    if (material.filePath !== filePath) {
      return json({ error: "filePath does not match the material" }, 400);
    }

    const policy = deps.policy ?? UPLOAD_POLICY;
    // Name and path first, so an unsupported type never reaches Storage.
    const byName = checkUpload({ fileName: material.fileName, storagePath: material.filePath }, policy);
    if (!byName.allowed) {
      return await refuse(material, byName, deps);
    }
    if (byName.pipeline !== "document") {
      return json({ error: "This material is not processed as a document" }, 400);
    }

    const bucket = bucketName || DEFAULT_BUCKET;
    const stored = await deps.readObjectHead(bucket, filePath);
    if (!stored) {
      return json({ error: "The uploaded file could not be found. Upload it again." }, 409);
    }
    const byType = checkUpload(
      { fileName: material.fileName, storagePath: material.filePath, contentType: stored.contentType },
      policy,
    );
    if (!byType.allowed) {
      return await refuse(material, byType, deps);
    }
    const byContents = checkUploadContents(material.fileName, byType, stored.head, policy);
    if (!byContents.allowed) {
      return await refuse(material, byContents, deps);
    }

    await deps.markQueued(materialId);
    await deps.enqueueJob(materialId, { filePath, fileType: byContents.extension, bucketName: bucket });
    deps.triggerWorker(materialId);

    return json({
      queued: true,
      materialId,
      message: "Document queued for background processing.",
    }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    console.error("Parse document enqueue error:", message);
    return json({ error: message }, 500);
  }
}
