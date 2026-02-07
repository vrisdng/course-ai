

# EduChat - AI Learning Assistant with RAG

## Overview
A professional AI-powered chatbot that helps students learn by answering questions with properly cited references from course materials. Uses **RAG (Retrieval-Augmented Generation)** to ground all answers in actual course content, ensuring accuracy and proper citations.

---

## Core Features

### 1. Authentication System
- **Email/password login with OTP verification** for secure access
- **Role-based accounts**: Students and Lecturers with different permissions
- **Clean, professional login page** matching institutional aesthetics
- Documentation included for future SSO or invite-code integration

### 2. Student Experience

#### AI Chat Interface with RAG
- **Main chat area** where students type questions and receive answers
- **Side panel** displaying sources used in each response:
  - Document name and type (PDF, video transcript, etc.)
  - Page number or timestamp reference
  - Clickable links to view the exact excerpt
  - Relevance score showing how closely the source matches the query
  - Clear visual connection between answer parts and their sources

#### Personal Document Uploads
- Upload personal notes or materials (private to the student)
- Documents are processed and indexed for RAG retrieval
- Ask questions specifically about uploaded content
- Separate from official course materials

#### Conversation History
- Access previous chat sessions
- Continue past conversations with full context

### 3. Lecturer Dashboard

#### Material Management
- **Upload course materials**: PDFs, lecture slides, video transcripts, code files
- **Automatic processing**: Documents are chunked, embedded, and indexed
- **Organize by topic or week** for easy navigation
- **Delete outdated materials** (removes from RAG index)
- Support for bulk uploads
- Processing status indicators

#### Usage Analytics
- View most frequently asked topics
- See common student questions
- Track which materials are cited most often
- Identify areas where students struggle
- Monitor RAG retrieval quality

#### Student Enrollment
- View enrolled students
- Add/remove student access
- Export student activity reports

### 4. RAG-Powered AI Response System

#### How RAG Works
1. **Document Ingestion**: When lecturers upload materials, they are:
   - Parsed (PDFs, transcripts, code files)
   - Split into semantic chunks (paragraphs, sections)
   - Converted to vector embeddings using AI
   - Stored in a vector database for fast retrieval

2. **Query Processing**: When a student asks a question:
   - The question is converted to a vector embedding
   - Similar chunks are retrieved from the vector database
   - Top relevant passages are ranked by relevance

3. **Answer Generation**: The AI:
   - Receives the question + retrieved passages
   - Generates an answer grounded in the content
   - Includes specific citations to source materials
   - Clearly states if information isn't available

#### Citation Quality
- Each answer includes numbered references
- References link to exact document locations
- Confidence indicators show citation reliability
- "Not found in materials" fallback when appropriate

---

## Design Approach

### Visual Style
- **Professional, institutional aesthetic**
- Clean typography with structured layouts
- Muted color palette (navy, gray, white)
- Clear visual hierarchy
- Responsive design for desktop and tablet

### Page Structure
1. **Landing/Login Page** - Professional welcome with auth options
2. **Student Dashboard** - Chat interface with source side panel
3. **Lecturer Dashboard** - Material management, analytics, and enrollment tabs
4. **Settings** - Account and preferences

---

## Technical Architecture

### Backend (Lovable Cloud + Supabase)
- **User authentication** with email/password and OTP
- **File storage** for course materials and student uploads
- **PostgreSQL database** for users, courses, materials, conversations
- **pgvector extension** for vector similarity search
- **Edge functions** for document processing and AI calls

### RAG Pipeline
- **Document processing**: Extract text from PDFs, parse transcripts
- **Chunking strategy**: Semantic splitting with overlap for context
- **Embedding generation**: Using Lovable AI to create vector embeddings
- **Vector storage**: Supabase with pgvector for similarity search
- **Retrieval**: Semantic search returning top-k relevant chunks
- **Generation**: Lovable AI (Gemini) for answer synthesis

### Data Schema
- **Users**: Students and lecturers with roles
- **Courses**: Course information and settings
- **Materials**: Metadata for uploaded documents
- **Chunks**: Processed document segments with embeddings
- **Conversations**: Chat history with message threading
- **Citations**: Links between responses and source chunks

---

## Development Phases

### Phase 1: Foundation
- Authentication system (login/signup with OTP)
- Database schema with pgvector extension
- Basic student chat interface
- Professional UI framework

### Phase 2: RAG Infrastructure
- Document upload and storage
- Text extraction and chunking pipeline
- Embedding generation and vector storage
- Semantic search implementation

### Phase 3: AI Chat with Citations
- RAG-powered question answering
- Citation generation and linking
- Side panel source display
- Conversation history

### Phase 4: Lecturer Tools
- Material management dashboard
- Processing status and management
- Student enrollment
- Usage analytics

### Phase 5: Enhanced Features
- Student personal document uploads with private RAG index
- Advanced analytics (topic clustering, gap analysis)
- Video transcript support
- Documentation for SSO integration

