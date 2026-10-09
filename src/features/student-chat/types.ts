export interface Citation {
  id: string;
  chunkId: string;
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
