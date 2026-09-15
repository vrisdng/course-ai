// Returns a signed URL for a specific page thumbnail of a PDF.
// The thumbnail must have been pre-rendered during material ingestion.
//
// Usage: POST /function/v1/pdf-page-thumbnail with body:
// {
//   "materialId": "<uuid>",
//   "pageNumber": 1
// }
//
// Returns:
// {
//   "signedUrl": "https://.../thumbnails/<materialId>/page-1.png?...",
//   "expiresIn": 600
// }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";

const SIGNED_URL_TTL_SECONDS = 600;
const THUMBNAIL_BUCKET = "course-materials";

interface PdfPageThumbnailRequest {
  materialId: string;
  pageNumber: number;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    // Auth + RLS read share one client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { materialId, pageNumber } = (await req.json()) as PdfPageThumbnailRequest;
    if (!materialId || !pageNumber || pageNumber < 1) {
      return new Response(JSON.stringify({ error: "materialId and pageNumber are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check material exists and user has access (RLS policy)
    const { data: material, error: materialError } = await supabase
      .from("materials")
      .select("id, file_path, thumbnail_path")
      .eq("id", materialId)
      .maybeSingle();

    if (materialError || !material) {
      return new Response(JSON.stringify({ error: "Material not found or access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse thumbnail paths from the JSON column
    let thumbnailPaths: Record<string, string> | null = null;
    try {
      thumbnailPaths = material.thumbnail_path ? JSON.parse(material.thumbnail_path) : null;
    } catch {
      // Ignore parse errors
    }

    if (!thumbnailPaths || !thumbnailPaths[pageNumber.toString()]) {
      return new Response(
        JSON.stringify({ error: `Thumbnail for page ${pageNumber} not found. The material may need to be re-processed.` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const thumbnailPath = thumbnailPaths[pageNumber.toString()];

    // Verify the thumbnail file exists
    const { data: thumbObjects, error: thumbError } = await supabase.storage
      .from(THUMBNAIL_BUCKET)
      .list(thumbnailPath.split("/").slice(0, -1).join("/"), {
        search: thumbnailPath.split("/").pop() || "",
        limit: 1,
      });

    if (thumbError || !thumbObjects || thumbObjects.length === 0) {
      return new Response(JSON.stringify({ error: "Thumbnail file not found in storage" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate signed URL for the thumbnail
    const { data: signed, error: signError } = await supabase.storage
      .from(THUMBNAIL_BUCKET)
      .createSignedUrl(thumbnailPath, SIGNED_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) {
      const message = signError?.message || "Unable to generate thumbnail URL";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ signedUrl: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("pdf-page-thumbnail error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
