import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { chunkText } from "../_shared/chunking.ts";
import { renderPdfPageToPng } from "../_shared/pdfThumbnail.ts";
import {
  buildExtractionPrompt,
  encodeBytesToBase64,
  fetchWithRetry,
  nextExtractionRange,
  normalizeRangeSegments,
  parseGeminiPageSegments,
  type ExtractedSegment,
  type PageRange,
} from "../_shared/extraction.ts";
import { countPdfPages } from "../_shared/pdfPages.ts";

interface ProcessMaterialJobRequest {
  materialId?: string;
  workerId?: string;
}

interface ChunkData {
  text: string;
  start: number;
  end: number;
  pageNumber: number | null;
}

// Resumable extraction state for multi-page PDFs: pages [1, nextPage) are done.
interface ExtractionState {
  segments: ExtractedSegment[];
  nextPage: number;
  totalPages: number;
}

interface JobPayload {
  filePath: string;
  fileType: string;
  bucketName: string;
  // Resumable state — set while a PDF is being extracted in page ranges
  extraction?: ExtractionState;
  // Resumable state — set after extraction+chunking is done
  chunks?: ChunkData[];
  embeddedUpTo?: number; // index of first un-embedded chunk
   totalChunks?: number;
   // Thumbnail paths for each page (page number -> storage path)
   thumbnailPaths?: { [pageNumber: string]: string };
 }

// Storage client interface for upload
interface StorageUploadClient {
  from(bucket: string): {
    upload: (path: string, data: Uint8Array, options?: StorageUploadOptions) => Promise<{ error: Error | null }>;
  };
}

interface StorageUploadOptions {
  contentType?: string;
  cacheControl?: string;
  upsert?: boolean;
}

const INLINE_GEMINI_MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_DOCUMENT_CHUNKS = 250;
const MAX_JOB_ATTEMPTS = 5;

// How many chunks to embed per invocation before yielding.
// Keeps each invocation well within Edge Runtime limits.
const EMBEDDING_SLICE_SIZE = 50;

// Gemini batchEmbedContents supports up to 100 texts per call.
const EMBEDDING_BATCH_API_SIZE = 100;

const EMBEDDING_PROGRESS_START = 70;
const EMBEDDING_PROGRESS_END = 95;

const GEMINI_VISION_MODEL = "gemini-3.8-flash";
const GEMINI_GENERATE_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;

// Extraction of a long PDF is split into page ranges so that no single Gemini
// call, and no single invocation, approaches the Edge Runtime wall-clock limit
// (150s on the free plan). Measured on a 47-page deck: ~1.4s/page, so a
// 16-page range is ~25s. After each range the segments are persisted to the
// job payload; once the invocation budget is spent the job is requeued and the
// next invocation resumes from the next page.
const EXTRACTION_PAGES_PER_CALL = 16;
const EXTRACTION_CALL_TIMEOUT_MS = 90_000;
const EXTRACTION_INVOCATION_BUDGET_MS = 70_000;
const EXTRACTION_PROGRESS_START = 25;
const EXTRACTION_PROGRESS_END = 50;

declare const EdgeRuntime:
  | { waitUntil?: (promise: Promise<unknown>) => void }
  | undefined;

// ---------------------------------------------------------------------------
// Text extraction helpers (unchanged)
// ---------------------------------------------------------------------------

function usesInlineGeminiExtraction(fileExtension: string): boolean {
  return ["pdf", "png", "jpg", "jpeg", "webp", "gif", "doc"].includes(fileExtension);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r");
}

function extractParagraphText(xml: string, textTagPattern: RegExp): string {
  const paragraphs = xml.split(/<\/(?:w:p|a:p)>/g);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const parts: string[] = [];
    const localRegex = new RegExp(textTagPattern.source, textTagPattern.flags);
    let match: RegExpExecArray | null;

    while ((match = localRegex.exec(paragraph)) !== null) {
      parts.push(decodeXmlEntities(match[1]));
    }

    const line = parts.join("").trim();
    if (line) lines.push(line);
  }

  return lines.join("\n").trim();
}

async function extractSegmentsFromDocx(fileBytes: Uint8Array): Promise<ExtractedSegment[]> {
  const { ZipReader, BlobReader, TextWriter } = await import(
    "https://deno.land/x/zipjs@v2.7.34/index.js"
  );

  const blob = new Blob([fileBytes]);
  const zipReader = new ZipReader(new BlobReader(blob));
  const entries = await zipReader.getEntries();

  let documentXml = "";
  for (const entry of entries) {
    if (entry.filename === "word/document.xml" && entry.getData) {
      const writer = new TextWriter();
      documentXml = await entry.getData(writer);
      break;
    }
  }
  await zipReader.close();

  if (!documentXml) {
    throw new Error("Could not find word/document.xml in DOCX file");
  }

  const pageBreakRegex = /<w:lastRenderedPageBreak\s*\/>|<w:br[^>]*w:type="page"[^>]*\/>/g;
  const xmlPages = documentXml.split(pageBreakRegex);

  const segments: ExtractedSegment[] = [];
  for (let i = 0; i < xmlPages.length; i++) {
    const text = extractParagraphText(xmlPages[i], /<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
    if (!text) {
      continue;
    }
    segments.push({
      text,
      pageNumber: i + 1,
    });
  }

  return segments;
}

async function extractSegmentsFromPptx(fileBytes: Uint8Array): Promise<ExtractedSegment[]> {
  const { ZipReader, BlobReader, TextWriter } = await import(
    "https://deno.land/x/zipjs@v2.7.34/index.js"
  );

  const blob = new Blob([fileBytes]);
  const zipReader = new ZipReader(new BlobReader(blob));
  const entries = await zipReader.getEntries();

  const slideEntries = entries
    .filter((entry: { filename: string }) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.filename))
    .sort((a: { filename: string }, b: { filename: string }) => {
      const numA = parseInt(a.filename.match(/slide(\d+)/)?.[1] || "0");
      const numB = parseInt(b.filename.match(/slide(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  const segments: ExtractedSegment[] = [];

  for (const entry of slideEntries) {
    if (!entry.getData) continue;
    const writer = new TextWriter();
    const xml = await entry.getData(writer);

    const text = extractParagraphText(xml, /<a:t>([\s\S]*?)<\/a:t>/g);
    const slideNum = Number(entry.filename.match(/slide(\d+)/)?.[1] || "0");
    if (text && Number.isFinite(slideNum) && slideNum > 0) {
      segments.push({
        text,
        pageNumber: slideNum,
      });
    }
  }

  await zipReader.close();
  return segments;
}

interface GeminiExtractionOptions {
  base64Data: string;
  mimeType: string;
  geminiApiKey: string;
  pageMarkers: boolean;
  range?: PageRange;
}

async function extractTextWithGemini(
  options: GeminiExtractionOptions,
): Promise<{ text: string; segments: ExtractedSegment[] }> {
  const response = await fetchWithRetry(
    GEMINI_GENERATE_URL,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": options.geminiApiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(EXTRACTION_CALL_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: buildExtractionPrompt({ pageMarkers: options.pageMarkers, range: options.range }) },
              { inlineData: { mimeType: options.mimeType, data: options.base64Data } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 65536,
        },
      }),
    },
    {
      maxRetries: 3,
      onRetry: ({ attempt, status, delayMs }) =>
        console.warn(`Gemini Vision ${status ?? "network error"}; retry ${attempt} in ${delayMs}ms`),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) {
      throw new Error("Gemini API rate limit exceeded after retries. Please wait and retry.");
    }
    if (response.status === 413 || errorText.includes("payload size")) {
      throw new Error(
        "File too large for Gemini Vision API. Maximum inline data size is ~20MB. Try splitting the document."
      );
    }
    throw new Error(`Gemini Vision API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini Vision returned no text content");
  }

  if (!options.pageMarkers) {
    return { text, segments: [{ text, pageNumber: null }] };
  }

  const parsedSegments = parseGeminiPageSegments(text);
  if (parsedSegments.length > 0) {
    return {
      text: parsedSegments.map((segment) => segment.text).join("\n\n"),
      segments: parsedSegments,
    };
  }

  return { text, segments: [{ text, pageNumber: options.range?.start ?? 1 }] };
}

interface PdfExtractionResult {
  done: boolean;
  state: ExtractionState;
}

// Extracts a PDF in page ranges, resuming from `state` if given. Returns early
// (done=false) once the invocation budget is spent so the caller can persist
// the state and requeue.
async function extractPdfInRanges(options: {
  fileBytes: Uint8Array;
  base64Data: string;
  geminiApiKey: string;
  state: ExtractionState | null;
  startedAt: number;
  onProgress: (progress: number) => Promise<void>;
}): Promise<PdfExtractionResult> {
  let state = options.state;

  if (!state) {
    const totalPages = await countPdfPages(options.fileBytes);
    if (totalPages === null || totalPages <= EXTRACTION_PAGES_PER_CALL) {
      // Short document (or unknown length): one call, as before.
      const extraction = await extractTextWithGemini({
        base64Data: options.base64Data,
        mimeType: "application/pdf",
        geminiApiKey: options.geminiApiKey,
        pageMarkers: true,
      });
      const pages = totalPages ?? Math.max(1, ...extraction.segments.map((s) => s.pageNumber ?? 1));
      return { done: true, state: { segments: extraction.segments, nextPage: pages + 1, totalPages: pages } };
    }
    state = { segments: [], nextPage: 1, totalPages };
  }

  let range = nextExtractionRange({
    nextPage: state.nextPage,
    totalPages: state.totalPages,
    pagesPerCall: EXTRACTION_PAGES_PER_CALL,
  });

  while (range) {
    console.log(`Extracting pages ${range.start}-${range.end} of ${state.totalPages}`);
    const extraction = await extractTextWithGemini({
      base64Data: options.base64Data,
      mimeType: "application/pdf",
      geminiApiKey: options.geminiApiKey,
      pageMarkers: true,
      range,
    });
    const rangeSegments = normalizeRangeSegments(extraction.segments, range);
    state = {
      segments: [...state.segments, ...rangeSegments],
      nextPage: range.end + 1,
      totalPages: state.totalPages,
    };

    const ratio = Math.min(1, (state.nextPage - 1) / state.totalPages);
    await options.onProgress(
      Math.round(EXTRACTION_PROGRESS_START + (EXTRACTION_PROGRESS_END - EXTRACTION_PROGRESS_START) * ratio),
    );

    range = nextExtractionRange({
      nextPage: state.nextPage,
      totalPages: state.totalPages,
      pagesPerCall: EXTRACTION_PAGES_PER_CALL,
    });

    if (range && Date.now() - options.startedAt > EXTRACTION_INVOCATION_BUDGET_MS) {
      return { done: false, state };
    }
  }

  return { done: true, state };
}

function getMimeType(fileType: string, fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return mimeMap[ext] || mimeMap[fileType] || "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Batch embedding — uses Gemini batchEmbedContents for up to 100 texts/call
// ---------------------------------------------------------------------------

interface EmbeddingResult {
  chunkIndex: number;
  embedding: number[];
}

async function batchEmbedWithRetry(
  texts: string[],
  startIndex: number,
  geminiApiKey: string,
): Promise<EmbeddingResult[]> {
  let lastStatus: number | null = null;
  let lastErrorText = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const requests = texts.map((text) => ({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: 1536,
    }));

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": geminiApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      },
    );

    if (response.ok) {
      const payload = await response.json();
      const embeddings = payload.embeddings;
      if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
        throw new Error(
          `batchEmbedContents returned ${embeddings?.length ?? 0} embeddings, expected ${texts.length}`,
        );
      }
      return embeddings.map(
        (emb: { values: number[] }, i: number): EmbeddingResult => ({
          chunkIndex: startIndex + i,
          embedding: emb.values,
        }),
      );
    }

    lastStatus = response.status;
    lastErrorText = await response.text();
    const isTransient = response.status === 429 || response.status >= 500;

    if (!isTransient || attempt === 2) {
      break;
    }

    const backoffMs = 2000 * (attempt + 1);
    console.warn(
      `batchEmbed retry ${attempt + 1} (chunks ${startIndex}-${startIndex + texts.length - 1}) after status ${response.status}; waiting ${backoffMs}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

   throw new Error(
     `Batch embedding failed (chunks ${startIndex}-${startIndex + texts.length - 1}): ${lastStatus ?? "unknown"} - ${lastErrorText || "No response body"}`,
   );
 }

// ---------------------------------------------------------------------------
// Thumbnail generation
// ---------------------------------------------------------------------------

interface ThumbnailPaths {
  [pageNumber: string]: string;
}

async function generatePdfThumbnails(
  pdfBytes: Uint8Array,
  segments: ExtractedSegment[],
  bucketName: string,
  storageClient: StorageUploadClient,
  materialId: string,
): Promise<ThumbnailPaths> {
  // Get unique page numbers from segments
  const uniquePages = new Set<number>();
  for (const segment of segments) {
    if (segment.pageNumber !== null && segment.pageNumber >= 1) {
      uniquePages.add(segment.pageNumber);
    }
  }

  if (uniquePages.size === 0) {
    console.log("No page numbers found in PDF segments, skipping thumbnail generation");
    return {};
  }

  const thumbnailPaths: ThumbnailPaths = {};
  const pages = Array.from(uniquePages).sort((a, b) => a - b);

  // Render thumbnails for each page (limit to first 10 pages for performance)
  const maxPages = 10;
  const pagesToRender = pages.slice(0, maxPages);

  console.log(`Rendering ${pagesToRender.length} PDF thumbnails (out of ${pages.length} total pages)`);

  for (const pageNumber of pagesToRender) {
    try {
      const pngBytes = await renderPdfPageToPng(pdfBytes, pageNumber, 280);
      
      const path = `thumbnails/${materialId}/page-${pageNumber}.png`;
      
      await storageClient
        .from(bucketName)
        .upload(path, pngBytes, {
          contentType: "image/png",
          cacheControl: "3600",
          upsert: false,
        });

      thumbnailPaths[pageNumber.toString()] = path;
      console.log(`Generated thumbnail for page ${pageNumber}: ${path}`);
    } catch (error) {
      console.error(`Failed to render thumbnail for page ${pageNumber}:`, error);
    }
  }

  return thumbnailPaths;
}

// ---------------------------------------------------------------------------
// Requeue + self-invoke (shared by the extraction and embedding stages)
// ---------------------------------------------------------------------------

async function requeueJobAndContinue(options: {
  adminClient: SupabaseClient;
  supabaseUrl: string;
  supabaseKey: string;
  jobId: string;
  materialId: string;
  payload: JobPayload;
}): Promise<void> {
  await options.adminClient
    .from("material_processing_jobs")
    .update({
      status: "pending",
      last_error: null,
      locked_at: null,
      locked_by: null,
      payload: options.payload as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", options.jobId);

  // Fire-and-forget: trigger next invocation
  const continueWorker = fetch(`${options.supabaseUrl}/functions/v1/process-material-job`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.supabaseKey}`,
      apikey: options.supabaseKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ materialId: options.materialId }),
  }).catch((err) => {
    console.error("Failed to trigger continuation:", err);
  });

  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    EdgeRuntime.waitUntil(continueWorker);
  } else {
    void continueWorker;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let materialIdForError: string | null = null;
  let jobIdForUpdate: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseKey);
    const requestBody = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const { materialId, workerId } = requestBody as ProcessMaterialJobRequest;

    // -----------------------------------------------------------------------
    // Claim a job
    // -----------------------------------------------------------------------
    const { data: claimedJobs, error: claimError } = await adminClient.rpc(
      "claim_material_processing_job",
      {
        worker_id: workerId || crypto.randomUUID(),
        requested_material_id: materialId || null,
        requested_job_type: "parse_document",
      }
    );

    if (claimError) {
      throw new Error(`Failed to claim processing job: ${claimError.message}`);
    }

    const job = Array.isArray(claimedJobs) ? claimedJobs[0] : null;
    if (!job) {
      return new Response(
        JSON.stringify({ processed: false, message: "No pending parse-document job found." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    jobIdForUpdate = job.id;
    materialIdForError = job.material_id;
    const claimedJobId: string = job.id;
    const claimedMaterialId: string = job.material_id;

    // Max attempts guard (also enforced in SQL, but belt-and-suspenders)
    if (job.attempt_count > MAX_JOB_ATTEMPTS) {
      await adminClient
        .from("material_processing_jobs")
        .update({
          status: "failed",
          last_error: `Exceeded maximum retry attempts (${MAX_JOB_ATTEMPTS})`,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobIdForUpdate);

      await adminClient
        .from("materials")
        .update({
          processing_status: "failed",
          processing_error: `Processing failed after ${MAX_JOB_ATTEMPTS} attempts. Please re-upload the document.`,
          processing_stage: "failed",
          processing_progress: null,
        })
        .eq("id", materialIdForError);

      return new Response(
        JSON.stringify({ processed: false, message: "Job exceeded max attempts." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = (typeof job.payload === "object" && job.payload
      ? job.payload
      : {}) as JobPayload;
    const filePath = payload.filePath || "";
    const fileType = payload.fileType || "";
    const bucketName = payload.bucketName || "course-materials";

    if (!filePath) {
      throw new Error("Queued parse job is missing filePath");
    }
    const invocationStartedAt = Date.now();

    // -----------------------------------------------------------------------
    // Check if this is a RESUMED invocation (chunks already extracted)
    // -----------------------------------------------------------------------
    const isResuming = Array.isArray(payload.chunks) && payload.chunks.length > 0;
    // Carried across invocations via the payload; generated on the fresh path.
    let thumbnailPaths: ThumbnailPaths | undefined = payload.thumbnailPaths;
    let chunks: ChunkData[];
    let totalChunks: number;
    let embeddedUpTo: number;

    if (isResuming) {
      // Resuming — skip extraction + chunking, go straight to embedding
      chunks = payload.chunks!;
      totalChunks = payload.totalChunks ?? chunks.length;
      embeddedUpTo = payload.embeddedUpTo ?? 0;

      console.log(
        `Resuming job ${jobIdForUpdate}: embedding from chunk ${embeddedUpTo}/${totalChunks}`,
      );
    } else {
      // Fresh job — extract text, chunk, then start embedding
      embeddedUpTo = 0;

      await adminClient
        .from("materials")
        .update({
          processing_status: "processing",
          processing_error: null,
          processing_stage: "extracting",
          processing_progress: EXTRACTION_PROGRESS_START,
        })
        .eq("id", materialIdForError);

      const { data: fileData, error: downloadError } = await adminClient.storage
        .from(bucketName)
        .download(filePath);

      if (downloadError || !fileData) {
        throw new Error(`Failed to download file: ${downloadError?.message || "No data"}`);
      }

      const fileBytes = new Uint8Array(await fileData.arrayBuffer());
      const ext = filePath.split(".").pop()?.toLowerCase() || fileType;

      if (usesInlineGeminiExtraction(ext) && fileBytes.length > INLINE_GEMINI_MAX_FILE_SIZE) {
        throw new Error(
          `File size (${(fileBytes.length / 1024 / 1024).toFixed(1)}MB) exceeds the 15MB processing limit for PDF, DOC, and image files. Please split the document into smaller parts.`
        );
      }

      const base64Data = usesInlineGeminiExtraction(ext) ? encodeBytesToBase64(fileBytes) : "";
      const updateExtractionProgress = async (progress: number) => {
        await adminClient
          .from("materials")
          .update({ processing_status: "processing", processing_stage: "extracting", processing_progress: progress })
          .eq("id", materialIdForError);
      };

      let extractedSegments: ExtractedSegment[] = [];
      switch (ext) {
        case "pdf": {
          const result = await extractPdfInRanges({
            fileBytes,
            base64Data,
            geminiApiKey,
            state: payload.extraction ?? null,
            startedAt: invocationStartedAt,
            onProgress: updateExtractionProgress,
          });
          if (!result.done) {
            // Budget spent with pages remaining: persist progress and hand the
            // rest to the next invocation.
            await requeueJobAndContinue({
              adminClient,
              supabaseUrl,
              supabaseKey,
              jobId: claimedJobId,
              materialId: claimedMaterialId,
              payload: { filePath, fileType, bucketName, extraction: result.state },
            });
            return new Response(
              JSON.stringify({
                success: true,
                jobId: jobIdForUpdate,
                materialId: materialIdForError,
                pagesExtracted: result.state.nextPage - 1,
                totalPages: result.state.totalPages,
                continuing: true,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          extractedSegments = result.state.segments;
          break;
        }
        case "png":
        case "jpg":
        case "jpeg":
        case "webp":
        case "gif": {
          const extraction = await extractTextWithGemini({
            base64Data,
            mimeType: getMimeType(ext, filePath),
            geminiApiKey,
            pageMarkers: false,
          });
          extractedSegments = extraction.segments;
          break;
        }
        case "docx": {
          extractedSegments = await extractSegmentsFromDocx(fileBytes);
          break;
        }
        case "doc": {
          const extraction = await extractTextWithGemini({
            base64Data,
            mimeType: getMimeType(ext, filePath),
            geminiApiKey,
            pageMarkers: true,
          });
          extractedSegments = extraction.segments;
          break;
        }
        case "pptx": {
          extractedSegments = await extractSegmentsFromPptx(fileBytes);
          break;
        }
        default:
          throw new Error(`Unsupported file type: ${ext}`);
      }
      if (extractedSegments.length === 0) {
        throw new Error("No text could be extracted from the document");
      }

      // --- Generate thumbnails for PDFs (if not already done) ---
      if (ext === "pdf" && !payload.thumbnailPaths) {
        console.log(`Generating thumbnails for ${filePath}`);
        thumbnailPaths = await generatePdfThumbnails(
          fileBytes,
          extractedSegments,
          bucketName,
          adminClient.storage,
          materialIdForError,
        );
        
        // Update job payload with thumbnail paths for resuming
        if (Object.keys(thumbnailPaths).length > 0) {
          await adminClient
            .from("material_processing_jobs")
            .update({
              payload: {
                ...payload,
                thumbnailPaths,
              },
            })
            .eq("id", jobIdForUpdate);
        }
      }

      // --- Chunking ---
      await adminClient
        .from("materials")
        .update({
          processing_status: "processing",
          processing_stage: "chunking",
          processing_progress: 55,
        })
        .eq("id", materialIdForError);

      const CHUNK_SIZE = 1200;
      const OVERLAP = 200;
      chunks = [];

      for (const segment of extractedSegments) {
        for (const chunk of chunkText(segment.text, CHUNK_SIZE, OVERLAP)) {
          chunks.push({ ...chunk, pageNumber: segment.pageNumber });
        }
      }

      if (chunks.length === 0) {
        throw new Error("No text chunks to process after extraction");
      }

      if (chunks.length > MAX_DOCUMENT_CHUNKS) {
        throw new Error(
          `Document expands to ${chunks.length} chunks, which exceeds the processing limit of ${MAX_DOCUMENT_CHUNKS}. Split the file into smaller parts.`,
        );
      }

      totalChunks = chunks.length;

      // Clear existing chunks for this material (fresh extraction)
      await adminClient.from("chunks").delete().eq("material_id", materialIdForError);
    }

    // -----------------------------------------------------------------------
    // Embedding (resumable — processes EMBEDDING_SLICE_SIZE chunks per run)
    // -----------------------------------------------------------------------
    const sliceEnd = Math.min(embeddedUpTo + EMBEDDING_SLICE_SIZE, totalChunks);
    const sliceChunks = chunks.slice(embeddedUpTo, sliceEnd);

    if (sliceChunks.length > 0) {
      // Update progress
      const overallRatio = totalChunks === 0 ? 1 : embeddedUpTo / totalChunks;
      const startProgress = Math.round(
        EMBEDDING_PROGRESS_START +
          (EMBEDDING_PROGRESS_END - EMBEDDING_PROGRESS_START) * overallRatio,
      );

      await adminClient
        .from("materials")
        .update({
          processing_status: "processing",
          processing_stage: "embedding",
          processing_progress: startProgress,
        })
        .eq("id", materialIdForError);

      // Embed in batches of EMBEDDING_BATCH_API_SIZE using batchEmbedContents
      const rows: Array<{
        material_id: string;
        chunk_index: number;
        chunk_text: string;
        embedding: number[];
        start_position: number;
        end_position: number;
        page_number: number | null;
      }> = [];

      for (let b = 0; b < sliceChunks.length; b += EMBEDDING_BATCH_API_SIZE) {
        const batchChunks = sliceChunks.slice(b, b + EMBEDDING_BATCH_API_SIZE);
        const batchTexts = batchChunks.map((c) => c.text);
        const globalOffset = embeddedUpTo + b;

        const embedResults = await batchEmbedWithRetry(batchTexts, globalOffset, geminiApiKey);

        for (let i = 0; i < embedResults.length; i++) {
          const chunk = batchChunks[i];
          rows.push({
            material_id: materialIdForError,
            chunk_index: embedResults[i].chunkIndex,
            chunk_text: chunk.text,
            embedding: embedResults[i].embedding,
            start_position: chunk.start,
            end_position: chunk.end,
            page_number: chunk.pageNumber,
          });
        }

        // Sync progress after each batch API call
        const batchDone = embeddedUpTo + b + batchChunks.length;
        const batchRatio = totalChunks === 0 ? 1 : batchDone / totalChunks;
        const batchProgress = Math.min(
          EMBEDDING_PROGRESS_END,
          Math.round(
            EMBEDDING_PROGRESS_START +
              (EMBEDDING_PROGRESS_END - EMBEDDING_PROGRESS_START) * batchRatio,
          ),
        );

        await adminClient
          .from("materials")
          .update({
            processing_status: "processing",
            processing_stage: "embedding",
            processing_progress: batchProgress,
          })
          .eq("id", materialIdForError);
      }

      // Insert embedded chunks into DB
      const DB_BATCH_SIZE = 100;
      for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
        const batch = rows.slice(i, i + DB_BATCH_SIZE);
        const { error: insertError } = await adminClient.from("chunks").insert(batch);
        if (insertError) {
          throw new Error(`Failed to insert chunks: ${insertError.message}`);
        }
      }
    }

    const newEmbeddedUpTo = sliceEnd;

     // -----------------------------------------------------------------------
     // Check: are we done, or do we need to continue in next invocation?
     // -----------------------------------------------------------------------
     if (newEmbeddedUpTo >= totalChunks) {
       // All chunks embedded — finalize
       
       
       // Update materials table with thumbnail paths
       if (thumbnailPaths && Object.keys(thumbnailPaths).length > 0) {
         await adminClient
           .from("materials")
           .update({
             thumbnail_path: JSON.stringify(thumbnailPaths),
           })
           .eq("id", materialIdForError);
       }
       
       await adminClient
         .from("materials")
         .update({
           processing_status: "completed",
           processing_error: null,
           processing_stage: "completed",
           processing_progress: 100,
         })
         .eq("id", materialIdForError);

       await adminClient
         .from("material_processing_jobs")
         .update({
           status: "completed",
           last_error: null,
           locked_at: null,
           locked_by: null,
           payload: { 
             filePath, 
             fileType, 
             bucketName, 
             totalChunks,
             thumbnailPaths,
           },
           updated_at: new Date().toISOString(),
         })
         .eq("id", jobIdForUpdate);

      return new Response(
        JSON.stringify({
          success: true,
          jobId: jobIdForUpdate,
          materialId: materialIdForError,
          chunksInserted: totalChunks,
          resumed: isResuming,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

     // Not done yet — save cursor and requeue for next invocation
     const updatedPayload: JobPayload = {
       filePath,
       fileType,
       bucketName,
       chunks,
       embeddedUpTo: newEmbeddedUpTo,
       totalChunks,
       thumbnailPaths,
     };

    await requeueJobAndContinue({
      adminClient,
      supabaseUrl,
      supabaseKey,
      jobId: claimedJobId,
      materialId: claimedMaterialId,
      payload: updatedPayload,
    });

    return new Response(
      JSON.stringify({
        success: true,
        jobId: jobIdForUpdate,
        materialId: materialIdForError,
        chunksEmbeddedThisRun: sliceChunks.length,
        embeddedUpTo: newEmbeddedUpTo,
        totalChunks,
        continuing: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    console.error("Process material job error:", message);

    if (materialIdForError) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const adminClient = createClient(supabaseUrl, supabaseKey);
        await adminClient
          .from("materials")
          .update({
            processing_status: "failed",
            processing_error: message,
            processing_stage: "failed",
            processing_progress: null,
          })
          .eq("id", materialIdForError);

        if (jobIdForUpdate) {
          await adminClient
            .from("material_processing_jobs")
            .update({
              status: "failed",
              last_error: message,
              locked_at: null,
              locked_by: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobIdForUpdate);
        }
      } catch (updateError) {
        console.error("Failed to update job error state:", updateError);
      }
    }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
