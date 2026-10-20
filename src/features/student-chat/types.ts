export interface VideoEvidenceSegment {
  id: string;
  segmentIndex: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface Citation {
  id: string;
  chunkId: string | null;
  excerpt: string;
  documentName: string;
  documentType: string;
  pageNumber?: number;
  startMs?: number;
  endMs?: number;
  relevanceScore: number;
  imageUrl?: string | null;
  materialId?: string | null;
  // Page blocks the answer cited within the chunk; absent = the whole chunk.
  blockIds?: string[];
  studentDocumentId?: string | null;
  evidenceSegments?: VideoEvidenceSegment[] | null;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  // While answering: what the assistant is doing (e.g. which search is running).
  status?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  courseId: string;
}
