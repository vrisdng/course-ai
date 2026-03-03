import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Gemini Vision API Constraints ───────────────────────────────────────────
// Model: gemini-2.5-flash (multimodal)
// Supported input types: PDF, PNG, JPEG, WEBP, GIF, HEIC, HEIF (DOC is best-effort via Gemini)
// Max inline data size: ~20MB base64 (before encoding ~15MB raw file)
// Max pages for PDF: ~100 pages per request (recommended: <50 for reliability)
// Free tier: 1500 requests/day (RPD), 1M tokens/min (TPM)
// Rate limits: 15 RPM on free tier, 2000 RPM on pay-as-you-go
// DOCX/PPTX are NOT natively supported by Gemini Vision — we extract text manually
// DOC (legacy) is sent to Gemini as application/msword (best-effort, may fail)
// ─────────────────────────────────────────────────────────────────────────────

interface ParseRequest {
  materialId: string;
  filePath: string;
  fileType: string;
  bucketName?: string;
}

interface ExtractedSegment {
  text: string;
  pageNumber: number | null;
}

const INLINE_GEMINI_MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB raw (safe limit for base64 encoding)

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

// ─── DOCX Text Extraction ────────────────────────────────────────────────────
// DOCX files are ZIP archives containing XML. We preserve page boundaries
// when explicit page-break tags are present.
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

// ─── PPTX Text Extraction ───────────────────────────────────────────────────
// PPTX files are ZIP archives containing XML slides at ppt/slides/slide*.xml
// We extract text from <a:t> tags in each slide and map slide number -> page.
async function extractSegmentsFromPptx(fileBytes: Uint8Array): Promise<ExtractedSegment[]> {
  const { ZipReader, BlobReader, TextWriter } = await import(
    "https://deno.land/x/zipjs@v2.7.34/index.js"
  );

  const blob = new Blob([fileBytes]);
  const zipReader = new ZipReader(new BlobReader(blob));
  const entries = await zipReader.getEntries();

  // Find all slide XML files and sort by slide number
  const slideEntries = entries
    .filter((e: { filename: string }) => /^ppt\/slides\/slide\d+\.xml$/.test(e.filename))
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

// ─── Gemini Vision Text Extraction ──────────────────────────────────────────
// Uses Gemini's multimodal generateContent API with inlineData.
// Supported MIME types: application/pdf, image/png, image/jpeg, image/webp
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

  console.log(
    `Sending ${(fileBytes.length / 1024 / 1024).toFixed(2)}MB file to Gemini Vision (${mimeType})`
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
    console.error("Gemini Vision API error:", response.status, errorText);

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

  console.log(`Extracted ${text.length} characters from document`);

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

  // Fallback when model does not follow page-marker format.
  return {
    text,
    segments: [{ text, pageNumber: 1 }],
  };
}

// ─── MIME Type Mapping ──────────────────────────────────────────────────────
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

// ─── Main Handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let materialIdForError: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify lecturer role
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (!profile || !["admin", "lecturer"].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: "Forbidden — lecturers only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { materialId, filePath, fileType, bucketName } =
      (await req.json()) as ParseRequest;
    materialIdForError = materialId;

    if (!materialId || !filePath) {
      return new Response(
        JSON.stringify({ error: "materialId and filePath are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Parsing document: ${filePath} (type: ${fileType})`);

    // Update status to processing
    const adminClient = createClient(supabaseUrl, supabaseKey);
    await adminClient
      .from("materials")
      .update({ processing_status: "processing", processing_error: null })
      .eq("id", materialId);

    // Download file from storage
    const bucket = bucketName || "course-materials";
    const { data: fileData, error: downloadError } = await adminClient.storage
      .from(bucket)
      .download(filePath);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message || "No data"}`);
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    console.log(`Downloaded file: ${(fileBytes.length / 1024).toFixed(1)}KB`);

    const ext = filePath.split(".").pop()?.toLowerCase() || fileType;
    if (usesInlineGeminiExtraction(ext) && fileBytes.length > INLINE_GEMINI_MAX_FILE_SIZE) {
      throw new Error(
        `File size (${(fileBytes.length / 1024 / 1024).toFixed(1)}MB) exceeds the 15MB processing limit for PDF, DOC, and image files. Please split the document into smaller parts.`
      );
    }

    // Extract text based on file type
    let extractedSegments: ExtractedSegment[] = [];
    let extractedTextLength = 0;

    switch (ext) {
      case "pdf": {
        const mimeType = getMimeType(ext, filePath);
        const extraction = await extractTextWithGemini(fileBytes, mimeType, geminiApiKey, true);
        extractedSegments = extraction.segments;
        extractedTextLength = extraction.text.length;
        break;
      }
      case "png":
      case "jpg":
      case "jpeg":
      case "webp":
      case "gif": {
        const mimeType = getMimeType(ext, filePath);
        const extraction = await extractTextWithGemini(fileBytes, mimeType, geminiApiKey, false);
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
        const mimeType = getMimeType(ext, filePath);
        const extraction = await extractTextWithGemini(fileBytes, mimeType, geminiApiKey, true);
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

    console.log(`Extracted ${extractedTextLength} chars across ${extractedSegments.length} segments, now chunking & embedding...`);

    // ─── Chunking & Embedding (inline to avoid cross-function calls) ──────
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

    console.log(`Created ${chunks.length} chunks, generating embeddings...`);

    // Generate embeddings for each chunk
    const rows: {
      material_id: string;
      chunk_index: number;
      chunk_text: string;
      embedding: number[];
      start_position: number;
      end_position: number;
      page_number: number | null;
    }[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const embResponse = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
        {
          method: "POST",
          headers: {
            "x-goog-api-key": geminiApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "models/gemini-embedding-001",
            content: { parts: [{ text: chunk.text }] },
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality: 1536,
          }),
        }
      );

      if (!embResponse.ok) {
        const errText = await embResponse.text();
        if (embResponse.status === 429) {
          // Back off and retry once after 2 seconds
          console.warn(`Rate limited at chunk ${i}, waiting 2s...`);
          await new Promise((r) => setTimeout(r, 2000));
          const retryResp = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
            {
              method: "POST",
              headers: {
                "x-goog-api-key": geminiApiKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "models/gemini-embedding-001",
                content: { parts: [{ text: chunk.text }] },
                taskType: "RETRIEVAL_DOCUMENT",
                outputDimensionality: 1536,
              }),
            }
          );
          if (!retryResp.ok) {
            throw new Error(`Embedding failed after retry at chunk ${i}`);
          }
          const retryData = await retryResp.json();
          rows.push({
            material_id: materialId,
            chunk_index: i,
            chunk_text: chunk.text,
            embedding: retryData.embedding.values,
            start_position: chunk.start,
            end_position: chunk.end,
            page_number: chunk.pageNumber,
          });
          continue;
        }
        throw new Error(`Embedding error at chunk ${i}: ${embResponse.status} - ${errText}`);
      }

      const embData = await embResponse.json();
      rows.push({
        material_id: materialId,
        chunk_index: i,
        chunk_text: chunk.text,
        embedding: embData.embedding.values,
        start_position: chunk.start,
        end_position: chunk.end,
        page_number: chunk.pageNumber,
      });
    }

    // Insert chunks in batches
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: insertError } = await adminClient.from("chunks").insert(batch);
      if (insertError) {
        throw new Error(`Failed to insert chunks: ${insertError.message}`);
      }
    }

    // Mark as completed
    await adminClient
      .from("materials")
      .update({ processing_status: "completed", processing_error: null })
      .eq("id", materialId);

    console.log(`✅ Successfully processed ${filePath}: ${rows.length} chunks embedded`);

    return new Response(
      JSON.stringify({
        success: true,
        chunksInserted: rows.length,
        textLength: extractedTextLength,
        pagesDetected: new Set(
          extractedSegments
            .map((segment) => segment.pageNumber)
            .filter((pageNumber): pageNumber is number => typeof pageNumber === "number" && pageNumber > 0)
        ).size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    console.error("Parse document error:", message);

    if (materialIdForError) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const adminClient = createClient(supabaseUrl, supabaseKey);
        await adminClient
          .from("materials")
          .update({ processing_status: "failed", processing_error: message })
          .eq("id", materialIdForError);
      } catch (updateErr) {
        console.error("Failed to update error status:", updateErr);
      }
    }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
