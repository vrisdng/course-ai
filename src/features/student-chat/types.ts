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
  studentDocumentId?: string | null;
  evidenceSegments?: VideoEvidenceSegment[] | null;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  courseId: string;
}
