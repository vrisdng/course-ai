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

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB raw (safe limit for base64 encoding)

// ─── DOCX Text Extraction ────────────────────────────────────────────────────
// DOCX files are ZIP archives containing XML. The main content is in
// word/document.xml. We extract all <w:t> text nodes from paragraphs.
async function extractTextFromDocx(fileBytes: Uint8Array): Promise<string> {
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

  // Extract text from XML using regex (Deno edge functions don't have DOMParser)
  // Match all <w:t ...>text</w:t> tags
  const textParts: string[] = [];
  const textRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  const paraRegex = /<\/w:p>/g;
  
  // Process paragraph by paragraph for better structure
  const paragraphs = documentXml.split(paraRegex);
  for (const para of paragraphs) {
    const parts: string[] = [];
    let match;
    const localRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    while ((match = localRegex.exec(para)) !== null) {
      parts.push(match[1]);
    }
    if (parts.length > 0) {
      textParts.push(parts.join(""));
    }
  }

  return textParts.join("\n").trim();
}

// ─── PPTX Text Extraction ───────────────────────────────────────────────────
// PPTX files are ZIP archives containing XML slides at ppt/slides/slide*.xml
// We extract text from <a:t> tags in each slide.
async function extractTextFromPptx(fileBytes: Uint8Array): Promise<string> {
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

  const slideTexts: string[] = [];

  for (const entry of slideEntries) {
    if (!entry.getData) continue;
    const writer = new TextWriter();
    const xml = await entry.getData(writer);

    // Extract all <a:t>text</a:t> tags
    const parts: string[] = [];
    const textRegex = /<a:t>([\s\S]*?)<\/a:t>/g;
    let match;
    while ((match = textRegex.exec(xml)) !== null) {
      parts.push(match[1]);
    }

    const slideNum = entry.filename.match(/slide(\d+)/)?.[1] || "?";
    if (parts.length > 0) {
      slideTexts.push(`[Slide ${slideNum}]\n${parts.join(" ")}`);
    }
  }

  await zipReader.close();
  return slideTexts.join("\n\n").trim();
}

// ─── Gemini Vision Text Extraction ──────────────────────────────────────────
// Uses Gemini's multimodal generateContent API with inlineData.
// Supported MIME types: application/pdf, image/png, image/jpeg, image/webp
async function extractTextWithGemini(
  fileBytes: Uint8Array,
  mimeType: string,
  geminiApiKey: string
): Promise<string> {
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
                text: `Extract ALL text content from this document verbatim. Preserve the original structure including:
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
  return text;
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

    if (fileBytes.length > MAX_FILE_SIZE) {
      throw new Error(
        `File size (${(fileBytes.length / 1024 / 1024).toFixed(1)}MB) exceeds the 15MB limit for processing. Please split the document into smaller parts.`
      );
    }

    // Extract text based on file type
    let extractedText = "";
    const ext = filePath.split(".").pop()?.toLowerCase() || fileType;

    switch (ext) {
      case "pdf": {
        const mimeType = getMimeType(ext, filePath);
        extractedText = await extractTextWithGemini(fileBytes, mimeType, geminiApiKey);
        break;
      }
      case "png":
      case "jpg":
      case "jpeg":
      case "webp":
      case "gif": {
        const mimeType = getMimeType(ext, filePath);
        extractedText = await extractTextWithGemini(fileBytes, mimeType, geminiApiKey);
        break;
      }
      case "docx": {
        extractedText = await extractTextFromDocx(fileBytes);
        break;
      }
      case "doc": {
        const mimeType = getMimeType(ext, filePath);
        extractedText = await extractTextWithGemini(fileBytes, mimeType, geminiApiKey);
        break;
      }
      case "pptx": {
        extractedText = await extractTextFromPptx(fileBytes);
        break;
      }
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error("No text could be extracted from the document");
    }

    console.log(`Extracted ${extractedText.length} chars, now chunking & embedding...`);

    // ─── Chunking & Embedding (inline to avoid cross-function calls) ──────
    const CHUNK_SIZE = 1200;
    const OVERLAP = 200;

    const normalized = extractedText.replace(/\r\n/g, "\n").replace(/\t/g, " ");
    const cleaned = normalized.replace(/[ ]{2,}/g, " ").trim();

    const step = Math.max(1, CHUNK_SIZE - OVERLAP);
    const chunks: { text: string; start: number; end: number }[] = [];
    for (let start = 0; start < cleaned.length; start += step) {
      const end = Math.min(start + CHUNK_SIZE, cleaned.length);
      const slice = cleaned.slice(start, end).trim();
      if (slice) chunks.push({ text: slice, start, end });
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
        textLength: extractedText.length,
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
