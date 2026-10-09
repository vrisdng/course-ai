-- Page blocks: the atomic, citable pieces of a PDF page (headings, paragraphs,
-- list items, standalone sentences, equations, tables, figures, captions).
--
-- process-material-job reads rendered page images into blocks
-- (supabase/functions/_shared/blocks.ts), snaps their boxes onto the page's
-- text lines, and builds chunks from whole blocks. Answers can then cite
-- individual blocks, and the viewer boxes exactly those. Boxes are
-- [x0, y0, x1, y1] page fractions, like material_pages and chunks.highlight_box.

CREATE TABLE IF NOT EXISTS public.page_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number >= 1),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  block_type text NOT NULL CHECK (
    block_type IN ('heading', 'paragraph', 'list_item', 'sentence', 'equation', 'table', 'figure', 'caption')
  ),
  text text NOT NULL,
  box jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id, page_number, ordinal)
);

ALTER TABLE public.page_blocks ENABLE ROW LEVEL SECURITY;

-- Readable by whoever can read the material (subquery runs under the caller's
-- materials RLS). Writes come only from the service role.
CREATE POLICY "Users can view blocks of materials they can access"
ON public.page_blocks FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.materials m WHERE m.id = page_blocks.material_id)
);

-- The blocks a chunk was built from, in order (null for chunks from
-- documents without blocks: transcripts, plain text, non-PDF uploads).
ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS block_ids uuid[];

-- The blocks an answer cited within the chunk (null/empty = the whole chunk).
ALTER TABLE public.citations ADD COLUMN IF NOT EXISTS block_ids uuid[];
