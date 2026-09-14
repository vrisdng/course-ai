// Generates a short-lived signed URL for an image-cited course material.
//
// A stored citation image path is a stable "<bucket>/<file_path>" reference, not
// a directly-loadable URL (the course-materials bucket is private), so the
// frontend must resolve a live URL on demand. Access is enforced with the
// caller's own credentials (RLS) BEFORE any service-role signing happens, which
// keeps the behaviour equivalent to the bucket's row-level policy: only users
// enrolled in the material's course — or admins — can obtain a URL.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { IMAGE_MATERIAL_TYPES } from "../_shared/citations.ts";

const SIGNED_URL_TTL_SECONDS = 600;
const IMAGE_STORAGE_BUCKET = "course-materials";

interface SignedMediaRequest {
  materialId: string;
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

    // Auth + RLS read share one client: the Authorization header makes material
    // selects honour row-level security for the calling user.
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

    const { materialId } = (await req.json()) as SignedMediaRequest;
    if (!materialId) {
      return new Response(JSON.stringify({ error: "materialId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: material, error: materialError } = await supabase
      .from("materials")
      .select("file_type, file_path")
      .eq("id", materialId)
      .maybeSingle();

    // A missing row means the user is not enrolled in / cannot access the
    // material's course, so refuse rather than revealing anything.
    if (materialError || !material || !material.file_path) {
      return new Response(JSON.stringify({ error: "Image source not accessible" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!IMAGE_MATERIAL_TYPES.has(material.file_type?.toLowerCase() ?? "")) {
      return new Response(JSON.stringify({ error: "Material is not an image" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(IMAGE_STORAGE_BUCKET)
      .createSignedUrl(material.file_path, SIGNED_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) {
      const message = signError?.message || "Unable to generate image URL";
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
    console.error("signed-media error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
