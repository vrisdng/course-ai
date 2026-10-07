import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { chunkText } from "../_shared/chunking.ts";
import {
  buildExtractionPrompt,
  encodeBytesToBase64,
  fetchWithRetry,
  initialPagesPerCall,
  MIN_PAGES_PER_CALL,
  nextExtractionRange,
  normalizeRangeSegments,
  parseGeminiPageSegments,
  shrinkPagesPerCall,
  type ExtractedSegment,
  type PageRange,
} from "../_shared/extraction.ts";
import { countPdfPages } from "../_shared/pdfPages.ts";
import { createOpenAIEmbeddingService, generateDocumentText, generatePageImagesText } from "../_shared/llm.ts";
import { EMBEDDING_COLUMN } from "../_shared/embeddings.ts";
import {
  createRendererClient,
  pageImagePath,
  runPageRenderBatch,
  type PageRenderState,
} from "../_shared/pageImages.ts";
import { chunkBlocks, type BlockType, type StoredBlock } from "../_shared/blocks.ts";
import {
  initialBlockExtractionState,
  runBlockExtractionBatch,
  type BlockExtractionState,
} from "../_shared/blockExtraction.ts";
import type { Box, PageLine } from "../_shared/highlights.ts";
import {
  convertOfficeDocument,
  createConverterClient,
  isConvertibleOffice,
} from "../_shared/officeConversion.ts";

interface ProcessMaterialJobRequest {
  materialId?: string;
  workerId?: string;
}

interface ChunkData {
  text: string;
  start: number;
  end: number;
  pageNumber: number | null;
  // Set for chunks built from page blocks (see _shared/blocks.ts).
  blockIds?: string[];
  highlightBox?: Box | null;
}

// Resumable extraction state for multi-page PDFs: pages [1, nextPage) are done.
// Persisted to the job payload after every range, so a killed run loses at
// most one range. pagesPerCall shrinks when a call times out.
interface ExtractionState {
  segments: ExtractedSegment[];
  nextPage: number;
  totalPages: number;
  pagesPerCall: number;
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
  // PDFs with the renderer configured go: page images (pageRender) → blocks
  // read from those images (blockExtraction) → chunks built from blocks →
  // embedding. Each stage is resumable and stored here between invocations.
  pageRender?: PageRenderState;
  blockExtraction?: BlockExtractionState;
  // Set when the page-image stages failed: the PDF is then extracted as
  // plain text from the file, without blocks.
  skipPageImages?: boolean;
}

const INLINE_GEMINI_MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_DOCUMENT_CHUNKS = 250;
const MAX_JOB_ATTEMPTS = 5;

// How many chunks to embed per invocation before yielding.
// Keeps each invocation well within Edge Runtime limits.
const EMBEDDING_SLICE_SIZE = 50;

const EMBEDDING_PROGRESS_START = 70;
const EMBEDDING_PROGRESS_END = 95;

// OCR for PDFs and images goes through OpenAI via the shared llm.ts wrapper
// (file/image parts inline). Gemini Vision is kept only for legacy .doc,
// which OpenAI does not accept as a file input.
const OCR_MODEL = "gpt-5.6-luna";
const OCR_MAX_OUTPUT_TOKENS = 32_000;
const GEMINI_VISION_MODEL = "gemini-3.8-flash";
const GEMINI_GENERATE_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;

// A long PDF is OCR'd one page range per invocation: claim, download, one
// OCR call, save the range into the job payload, requeue, self-invoke. The
// Edge Runtime kills a run at its wall clock (150s on the free plan) with no
// error handler, so each run must stay well inside that: the OCR call gets
// its own timeout, and a timeout shrinks the range for the retry instead of
// failing the job. Range size starts from page density (see extraction.ts).
const EXTRACTION_CALL_TIMEOUT_MS = 100_000;
const EXTRACTION_SINGLE_CALL_MAX_PAGES = 16;
const EXTRACTION_PROGRESS_START = 25;
const EXTRACTION_PROGRESS_END = 50;
const RENDERING_PROGRESS_START = 10;
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;

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

interface OpenAiExtractionOptions {
  base64Data: string;
  mimeType: string;
  filename: string;
  openAiApiKey: string;
  pageMarkers: boolean;
  range?: PageRange;
}

class ExtractionTimeoutError extends Error {
  constructor(range?: PageRange) {
    super(
      range
        ? `OCR call for pages ${range.start}-${range.end} exceeded ${EXTRACTION_CALL_TIMEOUT_MS / 1000}s`
        : `OCR call exceeded ${EXTRACTION_CALL_TIMEOUT_MS / 1000}s`,
    );
    this.name = "ExtractionTimeoutError";
  }
}

async function extractTextWithOpenAI(
  options: OpenAiExtractionOptions,
): Promise<{ text: string; segments: ExtractedSegment[] }> {
  const timeoutSignal = AbortSignal.timeout(EXTRACTION_CALL_TIMEOUT_MS);
  let text: string;
  try {
    text = await generateDocumentText({
      apiKey: options.openAiApiKey,
      model: OCR_MODEL,
      prompt: buildExtractionPrompt({ pageMarkers: options.pageMarkers, range: options.range }),
      file: { base64Data: options.base64Data, mimeType: options.mimeType, filename: options.filename },
      maxOutputTokens: OCR_MAX_OUTPUT_TOKENS,
      maxRetries: 3,
      signal: timeoutSignal,
    });
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new ExtractionTimeoutError(options.range);
    }
    throw error;
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

interface PdfExtractionStep {
  done: boolean;
  state: ExtractionState;
  // True when this run's OCR call timed out: no pages were added and the
  // range size was shrunk for the retry.
  timedOut: boolean;
}

// Performs exactly one OCR call for a PDF: either the whole document when it
// is short, or the next page range of a long one. Resumes from `state`.
async function extractNextPdfRange(options: {
  fileBytes: Uint8Array;
  base64Data: string;
  filename: string;
  openAiApiKey: string;
  state: ExtractionState | null;
}): Promise<PdfExtractionStep> {
  let state = options.state;

  if (!state) {
    const totalPages = await countPdfPages(options.fileBytes);
    if (totalPages === null || totalPages <= EXTRACTION_SINGLE_CALL_MAX_PAGES) {
      // Short document (or unknown length): one call for everything.
      const extraction = await extractTextWithOpenAI({
        base64Data: options.base64Data,
        mimeType: "application/pdf",
        filename: options.filename,
        openAiApiKey: options.openAiApiKey,
        pageMarkers: true,
      });
      const pages = totalPages ?? Math.max(1, ...extraction.segments.map((s) => s.pageNumber ?? 1));
      return {
        done: true,
        timedOut: false,
        state: { segments: extraction.segments, nextPage: pages + 1, totalPages: pages, pagesPerCall: pages },
      };
    }
    state = {
      segments: [],
      nextPage: 1,
      totalPages,
      pagesPerCall: initialPagesPerCall({ fileBytes: options.fileBytes.length, totalPages }),
    };
  }

  const range = nextExtractionRange({
    nextPage: state.nextPage,
    totalPages: state.totalPages,
    pagesPerCall: state.pagesPerCall,
  });
  if (!range) {
    return { done: true, timedOut: false, state };
  }

  console.log(`Extracting pages ${range.start}-${range.end} of ${state.totalPages} (${state.pagesPerCall}/call)`);
  let extraction: { segments: ExtractedSegment[] };
  try {
    extraction = await extractTextWithOpenAI({
      base64Data: options.base64Data,
      mimeType: "application/pdf",
      filename: options.filename,
      openAiApiKey: options.openAiApiKey,
      pageMarkers: true,
      range,
    });
  } catch (error) {
    if (error instanceof ExtractionTimeoutError && state.pagesPerCall > MIN_PAGES_PER_CALL) {
      const pagesPerCall = shrinkPagesPerCall(state.pagesPerCall);
      console.warn(`${error.message}; retrying with ${pagesPerCall} pages per call`);
      return { done: false, timedOut: true, state: { ...state, pagesPerCall } };
    }
    throw error;
  }

  const nextState: ExtractionState = {
    ...state,
    segments: [...state.segments, ...normalizeRangeSegments(extraction.segments, range)],
    nextPage: range.end + 1,
  };
  return { done: nextState.nextPage > nextState.totalPages, timedOut: false, state: nextState };
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
// Requeue + self-invoke (shared by the extraction and embedding stages)
// ---------------------------------------------------------------------------

async function requeueJobAndContinue(options: {
  adminClient: SupabaseClient;
  supabaseUrl: string;
  supabaseKey: string;
  jobId: string;
  materialId: string;
  // attempt_count as returned by the claim (already incremented for this run).
  attemptCount: number;
  payload: JobPayload;
}): Promise<void> {
  await options.adminClient
    .from("material_processing_jobs")
    .update({
      status: "pending",
      last_error: null,
      locked_at: null,
      locked_by: null,
      // A continuation is not a failed attempt. The next claim increments
      // again, so handing back this run's increment keeps the count flat
      // across continuations and only genuine failures consume the budget
      // of MAX_JOB_ATTEMPTS.
      attempt_count: Math.max(0, options.attemptCount - 1),
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
// Page images (after embedding; never fails the material)
// ---------------------------------------------------------------------------

const PDF_SIGNED_URL_TTL_SECONDS = 600;

interface PageRendererConfig {
  url: string;
  secret: string;
}

// Unset in an environment without the Vercel renderer: ingestion then skips
// page images and the citation viewer falls back to rendering the PDF itself.
function pageRendererConfig(): PageRendererConfig | null {
  const url = Deno.env.get("RENDER_SERVICE_URL");
  const secret = Deno.env.get("RENDER_SERVICE_SECRET");
  return url && secret ? { url, secret } : null;
}

function rendersPageImages(filePath: string, bucketName: string): boolean {
  return bucketName === "course-materials" && filePath.toLowerCase().endsWith(".pdf");
}

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface StageContext {
  adminClient: SupabaseClient;
  supabaseUrl: string;
  supabaseKey: string;
  jobId: string;
  materialId: string;
  attemptCount: number;
  // The file fields every payload carries.
  base: JobPayload;
}

async function updateMaterialProgress(
  adminClient: SupabaseClient,
  materialId: string,
  stage: string,
  progress: number,
): Promise<void> {
  await adminClient
    .from("materials")
    .update({ processing_status: "processing", processing_error: null, processing_stage: stage, processing_progress: progress })
    .eq("id", materialId);
}

// Abandons the page-image stages and restarts the job as a plain-text PDF
// extraction, so a renderer problem never leaves a material unprocessed.
async function fallBackToTextExtraction(context: StageContext, reason: string): Promise<Response> {
  console.warn(`Page images skipped for ${context.materialId}: ${reason}; extracting text from the file instead`);
  await context.adminClient.from("page_blocks").delete().eq("material_id", context.materialId);
  await requeueJobAndContinue({ ...context, payload: { ...context.base, skipPageImages: true } });
  return jsonResponse({ success: true, jobId: context.jobId, materialId: context.materialId, stage: "page_images", skipped: reason, continuing: true });
}

// Stage 1 for a PDF: one batch of page rendering per invocation. When every
// page has an image, hands over to block extraction.
async function runPageImageStage(context: StageContext, state: PageRenderState, renderer: PageRendererConfig): Promise<Response> {
  const { adminClient, materialId, base } = context;
  const { filePath, bucketName } = base;
  if (state.totalPages) {
    await updateMaterialProgress(
      adminClient,
      materialId,
      "rendering",
      Math.round(RENDERING_PROGRESS_START + (EXTRACTION_PROGRESS_START - RENDERING_PROGRESS_START) * ((state.nextPage - 1) / state.totalPages)),
    );
  }

  let result: Awaited<ReturnType<typeof runPageRenderBatch>>;
  try {
    result = await runPageRenderBatch(materialId, state, {
      createPdfDownloadUrl: async () => {
        const { data, error } = await adminClient.storage
          .from(bucketName)
          .createSignedUrl(filePath, PDF_SIGNED_URL_TTL_SECONDS);
        if (error || !data?.signedUrl) {
          throw new Error(`Could not sign the PDF for rendering: ${error?.message ?? "no URL"}`);
        }
        return data.signedUrl;
      },
      createUploadUrl: async (path) => {
        const { data, error } = await adminClient.storage
          .from(bucketName)
          .createSignedUploadUrl(path, { upsert: true });
        if (error || !data?.signedUrl) {
          throw new Error(`Could not sign an upload for ${path}: ${error?.message ?? "no URL"}`);
        }
        return data.signedUrl;
      },
      callRenderer: createRendererClient(renderer.url, renderer.secret),
      savePages: async (rows) => {
        const { error } = await adminClient.from("material_pages").upsert(rows);
        if (error) throw new Error(`Failed to save page images: ${error.message}`);
      },
    });
  } catch (error) {
    return fallBackToTextExtraction(context, error instanceof Error ? error.message : String(error));
  }

  if (result.failed.length > 0) {
    return fallBackToTextExtraction(context, `${result.failed.length} page(s) failed to render`);
  }

  if (!result.done) {
    await requeueJobAndContinue({ ...context, payload: { ...base, pageRender: result.state } });
    return jsonResponse({
      success: true,
      jobId: context.jobId,
      materialId,
      stage: "page_images",
      pagesRendered: result.rendered,
      nextPage: result.state.nextPage,
      totalPages: result.state.totalPages,
      continuing: true,
    });
  }

  const totalPages = result.state.totalPages ?? 0;
  const { count } = await adminClient
    .from("material_pages")
    .select("page_number", { count: "exact", head: true })
    .eq("material_id", materialId);
  if (totalPages < 1 || count !== totalPages) {
    return fallBackToTextExtraction(context, `${count ?? 0} of ${totalPages} pages have images`);
  }

  await requeueJobAndContinue({ ...context, payload: { ...base, blockExtraction: initialBlockExtractionState(totalPages) } });
  return jsonResponse({ success: true, jobId: context.jobId, materialId, stage: "page_images", totalPages, nextStage: "blocks", continuing: true });
}

function toStoredBlock(row: {
  id: string;
  page_number: number;
  ordinal: number;
  block_type: string;
  text: string;
  box: unknown;
}): StoredBlock {
  return {
    id: row.id,
    pageNumber: row.page_number,
    ordinal: row.ordinal,
    type: row.block_type as BlockType,
    text: row.text,
    box: Array.isArray(row.box) && row.box.length === 4 ? (row.box as Box) : null,
  };
}

// Stage 2 for a PDF: one batch of page images per invocation is read into
// blocks. When every page is done, builds chunks from whole blocks and hands
// them to the embedding stage.
async function runBlockStage(context: StageContext, state: BlockExtractionState, openAiApiKey: string): Promise<Response> {
  const { adminClient, materialId, base } = context;
  await updateMaterialProgress(
    adminClient,
    materialId,
    "extracting",
    Math.round(EXTRACTION_PROGRESS_START + (EXTRACTION_PROGRESS_END - EXTRACTION_PROGRESS_START) * ((state.nextPage - 1) / state.totalPages)),
  );

  const result = await runBlockExtractionBatch(state, {
    loadPageImage: async (pageNumber) => {
      const { data, error } = await adminClient.storage.from(base.bucketName).download(pageImagePath(materialId, pageNumber));
      if (error || !data) throw new Error(`Missing image for page ${pageNumber}: ${error?.message ?? "no data"}`);
      return { base64Data: encodeBytesToBase64(new Uint8Array(await data.arrayBuffer())), mimeType: "image/webp" };
    },
    loadPageLines: async (pageNumbers) => {
      const { data, error } = await adminClient
        .from("material_pages")
        .select("page_number, lines")
        .eq("material_id", materialId)
        .in("page_number", pageNumbers);
      if (error) throw new Error(`Failed to load page lines: ${error.message}`);
      return new Map((data ?? []).map((row) => [row.page_number as number, (row.lines ?? []) as PageLine[]]));
    },
    readBlocks: async (prompt, pages) => {
      const signal = AbortSignal.timeout(EXTRACTION_CALL_TIMEOUT_MS);
      try {
        return await generatePageImagesText({
          apiKey: openAiApiKey,
          model: OCR_MODEL,
          prompt,
          pages,
          maxOutputTokens: OCR_MAX_OUTPUT_TOKENS,
          maxRetries: 3,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw new ExtractionTimeoutError({ start: pages[0].pageNumber, end: pages[pages.length - 1].pageNumber });
        throw error;
      }
    },
    saveBlocks: async (blocks) => {
      const { error } = await adminClient.from("page_blocks").upsert(
        blocks.map((b) => ({
          material_id: materialId,
          page_number: b.pageNumber,
          ordinal: b.ordinal,
          block_type: b.type,
          text: b.text,
          box: b.box,
        })),
        { onConflict: "material_id,page_number,ordinal" },
      );
      if (error) throw new Error(`Failed to save page blocks: ${error.message}`);
    },
    isTimeout: (error) => error instanceof ExtractionTimeoutError,
  });

  if (!result.done) {
    await requeueJobAndContinue({
      ...context,
      // A timeout counts as an attempt; a normal continuation does not.
      attemptCount: result.timedOut ? context.attemptCount + 1 : context.attemptCount,
      payload: { ...base, blockExtraction: result.state },
    });
    return jsonResponse({
      success: true,
      jobId: context.jobId,
      materialId,
      stage: "blocks",
      blocksRead: result.blockCount,
      nextPage: result.state.nextPage,
      totalPages: result.state.totalPages,
      timedOut: result.timedOut,
      continuing: true,
    });
  }

  await updateMaterialProgress(adminClient, materialId, "chunking", 55);
  const { data: rows, error } = await adminClient
    .from("page_blocks")
    .select("id, page_number, ordinal, block_type, text, box")
    .eq("material_id", materialId)
    .order("page_number")
    .order("ordinal");
  if (error) throw new Error(`Failed to load page blocks: ${error.message}`);

  const chunks: ChunkData[] = chunkBlocks((rows ?? []).map(toStoredBlock), CHUNK_SIZE);
  if (chunks.length === 0) {
    throw new Error("No text could be extracted from the document");
  }
  if (chunks.length > MAX_DOCUMENT_CHUNKS) {
    throw new Error(
      `Document expands to ${chunks.length} chunks, which exceeds the processing limit of ${MAX_DOCUMENT_CHUNKS}. Split the file into smaller parts.`,
    );
  }

  await adminClient.from("chunks").delete().eq("material_id", materialId);
  await requeueJobAndContinue({ ...context, payload: { ...base, chunks, embeddedUpTo: 0, totalChunks: chunks.length } });
  return jsonResponse({ success: true, jobId: context.jobId, materialId, stage: "blocks", totalChunks: chunks.length, nextStage: "embedding", continuing: true });
}

// ---------------------------------------------------------------------------
// Office → PDF conversion (before extraction; falls back to XML extraction)
// ---------------------------------------------------------------------------

const CONVERTING_PROGRESS = 15;
const SOURCE_SIGNED_URL_TTL_SECONDS = 600;

interface OfficeConverterConfig {
  url: string;
  secret: string;
}

// Unset in an environment without the converter: DOCX/PPTX then keep the
// XML text extraction below and are never shown as pages.
function officeConverterConfig(): OfficeConverterConfig | null {
  const url = Deno.env.get("OFFICE_CONVERTER_URL");
  const secret = Deno.env.get("OFFICE_CONVERTER_SECRET");
  return url && secret ? { url, secret } : null;
}

// Converts the original to converted/<material_id>.pdf and records it on the
// material. Returns the PDF path, or null when conversion failed (logged) so
// the caller can fall back to extracting the original's XML text.
async function tryConvertOfficeDocument(options: {
  adminClient: SupabaseClient;
  converter: OfficeConverterConfig;
  materialId: string;
  bucketName: string;
  filePath: string;
  format: "docx" | "pptx";
}): Promise<string | null> {
  const { adminClient, converter, materialId, bucketName, filePath, format } = options;
  await adminClient
    .from("materials")
    .update({ processing_status: "processing", processing_stage: "converting", processing_progress: CONVERTING_PROGRESS })
    .eq("id", materialId);

  try {
    const pdfPath = await convertOfficeDocument(materialId, filePath, format, {
      createDownloadUrl: async (path) => {
        const { data, error } = await adminClient.storage
          .from(bucketName)
          .createSignedUrl(path, SOURCE_SIGNED_URL_TTL_SECONDS);
        if (error || !data?.signedUrl) throw new Error(`Could not sign the original: ${error?.message ?? "no URL"}`);
        return data.signedUrl;
      },
      createUploadUrl: async (path) => {
        const { data, error } = await adminClient.storage
          .from(bucketName)
          .createSignedUploadUrl(path, { upsert: true });
        if (error || !data?.signedUrl) throw new Error(`Could not sign the PDF upload: ${error?.message ?? "no URL"}`);
        return data.signedUrl;
      },
      callConverter: createConverterClient(converter.url, converter.secret),
    });

    const { error } = await adminClient.from("materials").update({ converted_pdf_path: pdfPath }).eq("id", materialId);
    if (error) throw new Error(`Failed to record the converted PDF: ${error.message}`);
    return pdfPath;
  } catch (error) {
    console.warn(`Office conversion failed for ${materialId}; falling back to text extraction:`, error);
    return null;
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
    const openAiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiApiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
    const claimedAttemptCount: number = Number(job.attempt_count) || 0;

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

    // -----------------------------------------------------------------------
    // PDF stages before embedding: page images, then blocks
    // -----------------------------------------------------------------------
    const stageContext: StageContext = {
      adminClient,
      supabaseUrl,
      supabaseKey,
      jobId: claimedJobId,
      materialId: claimedMaterialId,
      attemptCount: claimedAttemptCount,
      base: { filePath, fileType, bucketName },
    };
    const renderer = pageRendererConfig();

    if (payload.pageRender) {
      return renderer
        ? await runPageImageStage(stageContext, payload.pageRender, renderer)
        : await fallBackToTextExtraction(stageContext, "renderer not configured");
    }
    if (payload.blockExtraction) {
      return await runBlockStage(stageContext, payload.blockExtraction, openAiApiKey);
    }

    const isFreshJob = !payload.chunks && !payload.extraction;
    if (isFreshJob && !payload.skipPageImages && renderer && rendersPageImages(filePath, bucketName)) {
      await adminClient.from("material_pages").delete().eq("material_id", claimedMaterialId);
      await adminClient.from("page_blocks").delete().eq("material_id", claimedMaterialId);
      await updateMaterialProgress(adminClient, claimedMaterialId, "rendering", RENDERING_PROGRESS_START);
      return await runPageImageStage(stageContext, { nextPage: 1, totalPages: null }, renderer);
    }

    // -----------------------------------------------------------------------
    // DOCX/PPTX: convert to PDF, then continue as a PDF job
    // -----------------------------------------------------------------------
    const sourceExtension = filePath.split(".").pop()?.toLowerCase() || fileType;
    const converter = officeConverterConfig();
    if (
      converter &&
      bucketName === "course-materials" &&
      isConvertibleOffice(sourceExtension) &&
      !payload.chunks &&
      !payload.extraction
    ) {
      const pdfPath = await tryConvertOfficeDocument({
        adminClient,
        converter,
        materialId: claimedMaterialId,
        bucketName,
        filePath,
        format: sourceExtension,
      });
      if (pdfPath) {
        await requeueJobAndContinue({
          adminClient,
          supabaseUrl,
          supabaseKey,
          jobId: claimedJobId,
          materialId: claimedMaterialId,
          attemptCount: claimedAttemptCount,
          // From here the job is an ordinary PDF job; the original stays at
          // materials.file_path and the PDF at materials.converted_pdf_path.
          payload: { filePath: pdfPath, fileType: "pdf", bucketName },
        });
        return jsonResponse({
          success: true,
          jobId: claimedJobId,
          materialId: claimedMaterialId,
          stage: "converted",
          pdfPath,
          continuing: true,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Check if this is a RESUMED invocation (chunks already extracted)
    // -----------------------------------------------------------------------
    const isResuming = Array.isArray(payload.chunks) && payload.chunks.length > 0;
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
      // Fresh job, or a continuation of a partly extracted PDF — extract
      // text, chunk, then start embedding
      embeddedUpTo = 0;
      const resumedExtraction = payload.extraction;
      const initialProgress = resumedExtraction
        ? Math.round(
            EXTRACTION_PROGRESS_START +
              (EXTRACTION_PROGRESS_END - EXTRACTION_PROGRESS_START) *
                ((resumedExtraction.nextPage - 1) / resumedExtraction.totalPages),
          )
        : EXTRACTION_PROGRESS_START;

      await adminClient
        .from("materials")
        .update({
          processing_status: "processing",
          processing_error: null,
          processing_stage: "extracting",
          processing_progress: initialProgress,
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
          const step = await extractNextPdfRange({
            fileBytes,
            base64Data,
            filename: filePath.split("/").pop() || "document.pdf",
            openAiApiKey,
            state: payload.extraction ?? null,
          });
          if (!step.done) {
            // Save this range (or the shrunk range size after a timeout) and
            // hand the next range to a fresh invocation.
            const pagesDone = step.state.nextPage - 1;
            await updateExtractionProgress(
              Math.round(
                EXTRACTION_PROGRESS_START +
                  (EXTRACTION_PROGRESS_END - EXTRACTION_PROGRESS_START) * (pagesDone / step.state.totalPages),
              ),
            );
            await requeueJobAndContinue({
              adminClient,
              supabaseUrl,
              supabaseKey,
              jobId: claimedJobId,
              materialId: claimedMaterialId,
              // A timeout counts as an attempt; a normal continuation does not.
              attemptCount: step.timedOut ? claimedAttemptCount + 1 : claimedAttemptCount,
              payload: { filePath, fileType, bucketName, extraction: step.state },
            });
            return new Response(
              JSON.stringify({
                success: true,
                jobId: claimedJobId,
                materialId: claimedMaterialId,
                pagesExtracted: pagesDone,
                totalPages: step.state.totalPages,
                pagesPerCall: step.state.pagesPerCall,
                timedOut: step.timedOut,
                continuing: true,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          extractedSegments = step.state.segments;
          break;
        }
        case "png":
        case "jpg":
        case "jpeg":
        case "webp":
        case "gif": {
          const extraction = await extractTextWithOpenAI({
            base64Data,
            mimeType: getMimeType(ext, filePath),
            filename: filePath.split("/").pop() || `image.${ext}`,
            openAiApiKey,
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

      // --- Chunking ---
      await adminClient
        .from("materials")
        .update({
          processing_status: "processing",
          processing_stage: "chunking",
          processing_progress: 55,
        })
        .eq("id", materialIdForError);

      chunks = [];

      for (const segment of extractedSegments) {
        for (const chunk of chunkText(segment.text, CHUNK_SIZE, CHUNK_OVERLAP)) {
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

      const embeddingService = createOpenAIEmbeddingService(openAiApiKey);
      const vectors = await embeddingService.embedDocuments(
        sliceChunks.map((chunk) => chunk.text),
        {
          onProgress: async (embeddedInSlice) => {
            const embeddedRatio = totalChunks === 0 ? 1 : (embeddedUpTo + embeddedInSlice) / totalChunks;
            await adminClient
              .from("materials")
              .update({
                processing_status: "processing",
                processing_stage: "embedding",
                processing_progress: Math.min(
                  EMBEDDING_PROGRESS_END,
                  Math.round(
                    EMBEDDING_PROGRESS_START +
                      (EMBEDDING_PROGRESS_END - EMBEDDING_PROGRESS_START) * embeddedRatio,
                  ),
                ),
              })
              .eq("id", materialIdForError);
          },
        },
      );

      const rows = sliceChunks.map((chunk, i) => ({
        material_id: materialIdForError,
        chunk_index: embeddedUpTo + i,
        chunk_text: chunk.text,
        [EMBEDDING_COLUMN]: vectors[i],
        start_position: chunk.start,
        end_position: chunk.end,
        page_number: chunk.pageNumber,
        block_ids: chunk.blockIds ?? null,
        highlight_box: chunk.highlightBox ?? null,
      }));

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
       // All chunks embedded — the material is searchable from here on.
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
     };

    await requeueJobAndContinue({
      adminClient,
      supabaseUrl,
      supabaseKey,
      jobId: claimedJobId,
      materialId: claimedMaterialId,
      attemptCount: claimedAttemptCount,
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
