export interface Citation {
  id: string;
  chunkId: string;
  excerpt: string;
  documentName: string;
  documentType: string;
  pageNumber?: number;
  relevanceScore: number;
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
}
