// "Places" in course materials for keyword analytics: a document page, or a
// stretch of a video. The course-analytics function turns the chunks a
// teacher's keyword matched into places; the admin page shows them, lets the
// teacher untick wrong ones, and counts the questions whose answers cited
// them (get_course_questions_at_places).
//
// The admin page imports this file too, so keep it free of Deno and URL
// imports.

// One row of match_course_chunks_for_analytics.
export interface MatchedChunk {
  chunk_id: string;
  material_id: string;
  file_name: string;
  file_type: string;
  page_number: number | null;
  start_ms: number | null;
  end_ms: number | null;
  snippet: string;
  similarity: number;
}

export interface PlaceLocation {
  pageNumber: number | null;
  startMs: number | null;
  endMs: number | null;
}

export interface AnalyticsPlace extends PlaceLocation {
  key: string;
  materialId: string;
  fileName: string;
  fileType: string;
  // Best similarity of the chunks in this place, and that chunk's snippet.
  similarity: number;
  snippet: string;
  chunkCount: number;
}

// The JSON shape get_course_questions_at_places takes.
export type PlaceFilter =
  | { material_id: string; page_number: number | null }
  | { material_id: string; start_ms: number; end_ms: number };

// Keyword search settings. A short keyword scores lower against passages
// than a full question does, hence a lower floor than the chat's.
export const KEYWORD_MATCH_THRESHOLD = 0.25;
export const KEYWORD_MATCH_COUNT = 40;

// Video chunks of the same material closer than this merge into one place.
const VIDEO_MERGE_GAP_MS = 30_000;

export function placeKey(place: PlaceLocation & { materialId: string }): string {
  if (place.startMs !== null && place.endMs !== null) {
    return `${place.materialId}:time:${place.startMs}-${place.endMs}`;
  }
  return place.pageNumber === null ? `${place.materialId}:document` : `${place.materialId}:page:${place.pageNumber}`;
}

function toPlace(chunk: MatchedChunk, location: PlaceLocation): AnalyticsPlace {
  return {
    ...location,
    key: placeKey({ materialId: chunk.material_id, ...location }),
    materialId: chunk.material_id,
    fileName: chunk.file_name,
    fileType: chunk.file_type,
    similarity: chunk.similarity,
    snippet: chunk.snippet,
    chunkCount: 1,
  };
}

function absorb(place: AnalyticsPlace, chunk: MatchedChunk): void {
  place.chunkCount += 1;
  if (chunk.similarity > place.similarity) {
    place.similarity = chunk.similarity;
    place.snippet = chunk.snippet;
  }
}

function isTimed(chunk: MatchedChunk): chunk is MatchedChunk & { start_ms: number } {
  return chunk.start_ms !== null;
}

function mergeVideoChunks(chunks: Array<MatchedChunk & { start_ms: number }>): AnalyticsPlace[] {
  const sorted = [...chunks].sort((a, b) => a.start_ms - b.start_ms);
  const places: AnalyticsPlace[] = [];
  for (const chunk of sorted) {
    const end = chunk.end_ms ?? chunk.start_ms;
    const last = places[places.length - 1];
    if (last && last.endMs !== null && chunk.start_ms - last.endMs <= VIDEO_MERGE_GAP_MS) {
      absorb(last, chunk);
      last.endMs = Math.max(last.endMs, end);
      last.key = placeKey(last);
    } else {
      places.push(toPlace(chunk, { pageNumber: null, startMs: chunk.start_ms, endMs: end }));
    }
  }
  return places;
}

// Groups matched chunks into places, best match first.
export function groupChunksIntoPlaces(chunks: MatchedChunk[]): AnalyticsPlace[] {
  const documentPlaces = new Map<string, AnalyticsPlace>();
  const videoChunks = new Map<string, Array<MatchedChunk & { start_ms: number }>>();

  for (const chunk of chunks) {
    if (isTimed(chunk)) {
      const list = videoChunks.get(chunk.material_id) ?? [];
      list.push(chunk);
      videoChunks.set(chunk.material_id, list);
      continue;
    }
    const location: PlaceLocation = { pageNumber: chunk.page_number, startMs: null, endMs: null };
    const key = placeKey({ materialId: chunk.material_id, ...location });
    const existing = documentPlaces.get(key);
    if (existing) absorb(existing, chunk);
    else documentPlaces.set(key, toPlace(chunk, location));
  }

  const places = [...documentPlaces.values(), ...[...videoChunks.values()].flatMap(mergeVideoChunks)];
  return places.sort((a, b) => b.similarity - a.similarity);
}

export function toPlaceFilters(places: ReadonlyArray<AnalyticsPlace>): PlaceFilter[] {
  return places.map((place) =>
    place.startMs !== null && place.endMs !== null
      ? { material_id: place.materialId, start_ms: place.startMs, end_ms: place.endMs }
      : { material_id: place.materialId, page_number: place.pageNumber }
  );
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

// "Page 12", "Whole document" or "1:05–2:10".
export function formatPlaceLabel(place: PlaceLocation): string {
  if (place.startMs !== null && place.endMs !== null) {
    return `${formatTimestamp(place.startMs)}–${formatTimestamp(place.endMs)}`;
  }
  return place.pageNumber === null ? "Whole document" : `Page ${place.pageNumber}`;
}
