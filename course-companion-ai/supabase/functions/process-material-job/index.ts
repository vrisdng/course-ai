import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ProcessMaterialJobRequest {
  materialId?: string;
  workerId?: string;
}

interface ExtractedSegment {
  text: string;
  pageNumber: number | null;
}

const INLINE_GEMINI_MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_DOCUMENT_CHUNKS = 250;
const EMBEDDING_CONCURRENCY = 4;
const EMBEDDING_PROGRESS_START = 70;
const EMBEDDING_PROGRESS_END = 95;

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

function parseGeminiPageSegments(rawText: string): ExtractedSegment[] {
  const markerRegex = /^\s*\[Page\s+(\d+)\]\s*$/gim;
  const markers = Array.from(rawText.matchAll(markerRegex));

  if (markers.length === 0) {
    return [];
  }

  const segments: ExtractedSegment[] = [];

  for (let i = 0; i < markers.length; i++) {
    const current = markers[i];
    const next = markers[i + 1];
    const pageNumber = Number(current[1]);

    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      continue;
    }

    const markerStart = current.index ?? 0;
    const markerEnd = markerStart + current[0].length;
    const segmentEnd = next?.index ?? rawText.length;
    const segmentText = rawText.slice(markerEnd, segmentEnd).trim();

    if (segmentText) {
      segments.push({
        text: segmentText,
        pageNumber,
      });
    }
  }

  return segments;
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

async function extractTextWithGemini(
  fileBytes: Uint8Array,
  mimeType: string,
  geminiApiKey: string,
  requestPageMarkers: boolean
): Promise<{ text: string; segments: ExtractedSegment[] }> {
  const base64Data = btoa(
    Array.from(fileBytes)
      .map((b) => String.fromCharCode(b))
      .join("")
  );

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: requestPageMarkers
                  ? `Extract ALL text content from this document verbatim.
Return output page-by-page in this exact format:
[Page 1]
<text from page 1>
[Page 2]
<text from page 2>

Rules:
- Keep page markers exactly as [Page N].
- Include every page in order.
- Do NOT summarize.
- Do NOT add commentary.
- Return ONLY extracted text content with these page markers.`
                  : `Extract ALL text content from this document verbatim. Preserve the original structure including:
- Headings and subheadings
- Paragraphs
- Bullet points and numbered lists
- Table content (format as readable text)
- Captions and labels
- Any mathematical formulas (in plain text or LaTeX notation)

Do NOT summarize. Do NOT add commentary. Return ONLY the extracted text content.`,
              },
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 65536,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    if (response.status === 429) {
      throw new Error(
        "Gemini API rate limit exceeded. Free tier allows 15 requests/min and 1500 requests/day. Please wait and retry."
      );
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

  if (!requestPageMarkers) {
    return {
      text,
      segments: [{ text, pageNumber: null }],
    };
  }

  const parsedSegments = parseGeminiPageSegments(text);
  if (parsedSegments.length > 0) {
    return {
      text: parsedSegments.map((segment) => segment.text).join("\n\n"),
      segments: parsedSegments,
    };
  }

  return {
    text,
    segments: [{ text, pageNumber: 1 }],
  };
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

async function embedChunkWithRetry(
  chunkText: string,
  geminiApiKey: string,
  chunkIndex: number,
): Promise<number[]> {
  let lastStatus: number | null = null;
  let lastErrorText = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": geminiApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: chunkText }] },
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 1536,
        }),
      },
    );

    if (response.ok) {
      const payload = await response.json();
      const values = payload.embedding?.values;
      if (!Array.isArray(values)) {
        throw new Error(`Embedding response did not include values at chunk ${chunkIndex}`);
      }
      return values as number[];
    }

    lastStatus = response.status;
    lastErrorText = await response.text();
    const isTransient = response.status === 429 || response.status >= 500;

    if (!isTransient || attempt === 2) {
      break;
    }

    const backoffMs = 1500 * (attempt + 1);
    console.warn(
      `Embedding retry ${attempt + 1} for chunk ${chunkIndex} after status ${response.status}; waiting ${backoffMs}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  throw new Error(
    `Embedding failed at chunk ${chunkIndex}: ${lastStatus ?? "unknown"} - ${lastErrorText || "No response body"}`,
  );
}

async function embedChunksConcurrently(options: {
  chunks: Array<{ text: string; start: number; end: number; pageNumber: number | null }>;
  geminiApiKey: string;
  materialId: string;
  adminClient: ReturnType<typeof createClient>;
}): Promise<Array<{
  material_id: string;
  chunk_index: number;
  chunk_text: string;
  embedding: number[];
  start_position: number;
  end_position: number;
  page_number: number | null;
}>> {
  const results: Array<{
    material_id: string;
    chunk_index: number;
    chunk_text: string;
    embedding: number[];
    start_position: number;
    end_position: number;
    page_number: number | null;
  }> = new Array(options.chunks.length);

  let nextIndex = 0;
  let completedCount = 0;

  const syncProgress = async () => {
    const completionRatio =
      options.chunks.length === 0 ? 1 : completedCount / options.chunks.length;
    const nextProgress = Math.min(
      EMBEDDING_PROGRESS_END,
      Math.round(
        EMBEDDING_PROGRESS_START +
          (EMBEDDING_PROGRESS_END - EMBEDDING_PROGRESS_START) * completionRatio,
      ),
    );

    await options.adminClient
      .from("materials")
      .update({
        processing_status: "processing",
        processing_stage: "embedding",
        processing_progress: nextProgress,
      })
      .eq("id", options.materialId);
  };

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= options.chunks.length) {
        return;
      }

      const chunk = options.chunks[currentIndex];
      const embedding = await embedChunkWithRetry(
        chunk.text,
        options.geminiApiKey,
        currentIndex,
      );

      results[currentIndex] = {
        material_id: options.materialId,
        chunk_index: currentIndex,
        chunk_text: chunk.text,
        embedding,
        start_position: chunk.start,
        end_position: chunk.end,
        page_number: chunk.pageNumber,
      };

      completedCount += 1;
      if (
        completedCount === options.chunks.length ||
        completedCount % EMBEDDING_CONCURRENCY === 0
      ) {
        await syncProgress();
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(EMBEDDING_CONCURRENCY, options.chunks.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return results;
}

serve(async (req) => {
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

    const payload = typeof job.payload === "object" && job.payload ? job.payload as Record<string, unknown> : {};
    const filePath = typeof payload.filePath === "string" ? payload.filePath : "";
    const fileType = typeof payload.fileType === "string" ? payload.fileType : "";
    const bucketName = typeof payload.bucketName === "string" ? payload.bucketName : "course-materials";

    if (!filePath) {
      throw new Error("Queued parse job is missing filePath");
    }

    await adminClient
      .from("materials")
      .update({
        processing_status: "processing",
        processing_error: null,
        processing_stage: "extracting",
        processing_progress: 25,
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

    let extractedSegments: ExtractedSegment[] = [];
    let extractedTextLength = 0;

    switch (ext) {
      case "pdf": {
        const extraction = await extractTextWithGemini(fileBytes, getMimeType(ext, filePath), geminiApiKey, true);
        extractedSegments = extraction.segments;
        extractedTextLength = extraction.text.length;
        break;
      }
      case "png":
      case "jpg":
      case "jpeg":
      case "webp":
      case "gif": {
        const extraction = await extractTextWithGemini(fileBytes, getMimeType(ext, filePath), geminiApiKey, false);
        extractedSegments = extraction.segments;
        extractedTextLength = extraction.text.length;
        break;
      }
      case "docx": {
        extractedSegments = await extractSegmentsFromDocx(fileBytes);
        extractedTextLength = extractedSegments.reduce((sum, segment) => sum + segment.text.length, 0);
        break;
      }
      case "doc": {
        const extraction = await extractTextWithGemini(fileBytes, getMimeType(ext, filePath), geminiApiKey, true);
        extractedSegments = extraction.segments;
        extractedTextLength = extraction.text.length;
        break;
      }
      case "pptx": {
        extractedSegments = await extractSegmentsFromPptx(fileBytes);
        extractedTextLength = extractedSegments.reduce((sum, segment) => sum + segment.text.length, 0);
        break;
      }
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }

    if (extractedSegments.length === 0) {
      throw new Error("No text could be extracted from the document");
    }

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
    const step = Math.max(1, CHUNK_SIZE - OVERLAP);
    const chunks: { text: string; start: number; end: number; pageNumber: number | null }[] = [];

    for (const segment of extractedSegments) {
      const normalized = segment.text.replace(/\r\n/g, "\n").replace(/\t/g, " ");
      const cleaned = normalized.replace(/[ ]{2,}/g, " ").trim();
      if (!cleaned) continue;

      for (let start = 0; start < cleaned.length; start += step) {
        const end = Math.min(start + CHUNK_SIZE, cleaned.length);
        const slice = cleaned.slice(start, end).trim();
        if (slice) {
          chunks.push({
            text: slice,
            start,
            end,
            pageNumber: segment.pageNumber,
          });
        }
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

    await adminClient.from("chunks").delete().eq("material_id", materialIdForError);

    await adminClient
      .from("materials")
      .update({
        processing_status: "processing",
        processing_stage: "embedding",
        processing_progress: 75,
      })
      .eq("id", materialIdForError);

    const rows = await embedChunksConcurrently({
      chunks,
      geminiApiKey,
      materialId: materialIdForError,
      adminClient,
    });

    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: insertError } = await adminClient.from("chunks").insert(batch);
      if (insertError) {
        throw new Error(`Failed to insert chunks: ${insertError.message}`);
      }
    }

    await adminClient
      .from("materials")
      .update({
        processing_status: "processing",
        processing_stage: "finalizing",
        processing_progress: 95,
      })
      .eq("id", materialIdForError);

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
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobIdForUpdate);

    return new Response(
      JSON.stringify({
        success: true,
        jobId: jobIdForUpdate,
        materialId: materialIdForError,
        chunksInserted: rows.length,
        textLength: extractedTextLength,
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
