export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export function buildOpenAIProviderOptions(reasoningEffort?: ReasoningEffort):
  | { openai: { reasoningEffort: ReasoningEffort } }
  | undefined {
  if (!reasoningEffort) {
    return undefined;
  }

  return { openai: { reasoningEffort } };
}

export function requireGeneratedText(
  text: string,
  model: string,
  finishReason: unknown,
): string {
  const cleaned = text.trim();
  if (cleaned) {
    return cleaned;
  }

  const reason = typeof finishReason === "string" ? finishReason : "unknown";
  throw new Error(`OpenAI model ${model} returned empty text (finish reason: ${reason})`);
}

export interface DocumentInput {
  // Base64-encoded file bytes (no data: prefix).
  base64Data: string;
  mimeType: string;
  filename: string;
}

export type DocumentContentPart =
  | { type: "text"; text: string }
  | { type: "file"; data: string; mimeType: string; filename: string }
  | { type: "image"; image: string; mimeType: string };

export interface DocumentUserMessage {
  role: "user";
  content: DocumentContentPart[];
}

// Builds the single user message for document text extraction. PDFs go as a
// file part (the OpenAI provider sends them as file_data); raster images go
// as an image part. Anything else is rejected up front rather than at the API.
export function buildDocumentExtractionMessages(prompt: string, file: DocumentInput): DocumentUserMessage[] {
  const mimeType = file.mimeType.toLowerCase();
  let part: DocumentContentPart;
  if (mimeType === "application/pdf") {
    part = { type: "file", data: file.base64Data, mimeType, filename: file.filename };
  } else if (mimeType.startsWith("image/")) {
    part = { type: "image", image: file.base64Data, mimeType };
  } else {
    throw new Error(`Unsupported document type for OpenAI extraction: ${file.mimeType}`);
  }
  return [{ role: "user", content: [{ type: "text", text: prompt }, part] }];
}
