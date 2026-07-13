import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHAT_MODEL = "gemini-3-flash-preview";
const MAX_FLASHCARDS = 10;

interface FlashcardRequest {
  messageId: string;
  conversationId: string;
  courseId: string;
  chunkIds?: string[];
}

interface Flashcard {
  question: string;
  answer: string;
}

interface GeminiContent {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

function extractGeminiText(data: unknown): string {
  const content = data as GeminiContent;
  return (
    content?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text ?? "")
      .join("") ?? ""
  );
}

async function generateFlashcardsWithGemini(
  geminiApiKey: string,
  contextText: string,
  count: number
): Promise<Flashcard[]> {
  const systemPrompt = `You are an expert educational flashcard creator. Your task is to generate concise, clear flashcards from study material.

Rules:
- Each flashcard must have a clear, focused question and a complete but concise answer
- Questions should test understanding, not just recall
- Answers should be self-contained and accurate
- Avoid overly broad questions
- Return ONLY valid JSON, no markdown, no explanation`;

  const userPrompt = `Generate exactly ${count} flashcards from the following study material. Return a JSON array of objects with "question" and "answer" fields.

Study material:
${contextText}

Return format (JSON array only):
[{"question": "...", "answer": "..."}, ...]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2000,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API error:", response.status, errorText);
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const rawText = extractGeminiText(data).trim();

  // Strip markdown code fences if present
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    console.error("Failed to parse Gemini JSON output:", rawText);
    throw new Error("Failed to parse flashcard response from AI.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Unexpected flashcard response format from AI.");
  }

  return (parsed as Array<{ question?: unknown; answer?: unknown }>)
    .filter(
      (item) =>
        typeof item?.question === "string" && typeof item?.answer === "string"
    )
    .map((item) => ({
      question: (item.question as string).trim(),
      answer: (item.answer as string).trim(),
    }))
    .slice(0, MAX_FLASHCARDS);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !geminiApiKey) {
      throw new Error("Missing required environment variables.");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as FlashcardRequest;
    const { messageId, conversationId, courseId, chunkIds } = body;

    if (!messageId || !conversationId || !courseId) {
      return new Response(
        JSON.stringify({ error: "messageId, conversationId, and courseId are required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify the user owns this conversation
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, user_id, course_id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (convError || !conversation) {
      return new Response(JSON.stringify({ error: "Conversation not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the assistant message content
    const { data: messageRow, error: messageError } = await supabase
      .from("messages")
      .select("id, role, content, conversation_id")
      .eq("id", messageId)
      .eq("conversation_id", conversationId)
      .single();

    if (messageError || !messageRow) {
      return new Response(JSON.stringify({ error: "Message not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (messageRow.role !== "assistant") {
      return new Response(
        JSON.stringify({ error: "Flashcards can only be generated from assistant messages." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build context from message content and chunk excerpts
    let contextParts: string[] = [messageRow.content];

    if (chunkIds && chunkIds.length > 0) {
      const { data: chunkRows } = await supabase
        .from("chunks")
        .select("chunk_text")
        .in("id", chunkIds)
        .limit(6);

      if (chunkRows && chunkRows.length > 0) {
        const chunkTexts = chunkRows
          .map((c) => c.chunk_text as string)
          .filter(Boolean)
          .map((t) => t.slice(0, 800));
        contextParts = [...contextParts, ...chunkTexts];
      }
    }

    const contextText = contextParts
      .join("\n\n---\n\n")
      .slice(0, 6000);

    const requestedCount = Math.min(
      Math.max(3, Math.ceil(contextText.length / 500)),
      MAX_FLASHCARDS
    );

    const flashcards = await generateFlashcardsWithGemini(
      geminiApiKey,
      contextText,
      requestedCount
    );

    return new Response(JSON.stringify({ flashcards }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-flashcards error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
