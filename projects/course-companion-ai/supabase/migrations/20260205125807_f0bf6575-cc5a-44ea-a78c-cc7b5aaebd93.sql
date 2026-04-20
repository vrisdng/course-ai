-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create enum for user roles
CREATE TYPE public.user_role AS ENUM ('student', 'lecturer');

-- Create enum for material/document types
CREATE TYPE public.document_type AS ENUM ('pdf', 'transcript', 'code', 'slides', 'notes', 'other');

-- Create enum for processing status
CREATE TYPE public.processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Create profiles table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role public.user_role NOT NULL DEFAULT 'student',
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create courses table
CREATE TABLE public.courses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  code TEXT UNIQUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create enrollments table (student-course relationship)
CREATE TABLE public.enrollments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, course_id)
);

-- Create materials table (course documents uploaded by lecturers)
CREATE TABLE public.materials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type public.document_type NOT NULL DEFAULT 'other',
  file_size BIGINT,
  topic TEXT,
  week_number INTEGER,
  processing_status public.processing_status NOT NULL DEFAULT 'pending',
  processing_error TEXT,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create student_documents table (private documents uploaded by students)
CREATE TABLE public.student_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type public.document_type NOT NULL DEFAULT 'other',
  file_size BIGINT,
  processing_status public.processing_status NOT NULL DEFAULT 'pending',
  processing_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create chunks table for RAG (stores document segments with embeddings)
CREATE TABLE public.chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  material_id UUID REFERENCES public.materials(id) ON DELETE CASCADE,
  student_document_id UUID REFERENCES public.student_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding extensions.vector(1536),
  page_number INTEGER,
  start_position INTEGER,
  end_position INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT chunk_source_check CHECK (
    (material_id IS NOT NULL AND student_document_id IS NULL) OR
    (material_id IS NULL AND student_document_id IS NOT NULL)
  )
);

-- Create conversations table
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create messages table
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create citations table (links messages to source chunks)
CREATE TABLE public.citations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES public.chunks(id) ON DELETE CASCADE,
  relevance_score FLOAT,
  excerpt TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create vector similarity search index
CREATE INDEX chunks_embedding_idx ON public.chunks 
USING ivfflat (embedding extensions.vector_cosine_ops)
WITH (lists = 100);

-- Create other useful indexes
CREATE INDEX idx_materials_course ON public.materials(course_id);
CREATE INDEX idx_chunks_material ON public.chunks(material_id);
CREATE INDEX idx_chunks_student_doc ON public.chunks(student_document_id);
CREATE INDEX idx_conversations_user ON public.conversations(user_id);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX idx_citations_message ON public.citations(message_id);
CREATE INDEX idx_enrollments_user ON public.enrollments(user_id);
CREATE INDEX idx_enrollments_course ON public.enrollments(course_id);

-- Helper function: Check if user is a lecturer
CREATE OR REPLACE FUNCTION public.is_lecturer(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = check_user_id AND role = 'lecturer'
  );
END;
$$;

-- Helper function: Check if user is enrolled in a course
CREATE OR REPLACE FUNCTION public.is_enrolled(check_user_id UUID, check_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.enrollments
    WHERE user_id = check_user_id AND course_id = check_course_id
  );
END;
$$;

-- Helper function: Check if user is lecturer for a specific course
CREATE OR REPLACE FUNCTION public.is_course_lecturer(check_user_id UUID, check_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.courses c ON c.created_by = p.id
    WHERE p.user_id = check_user_id AND c.id = check_course_id AND p.role = 'lecturer'
  );
END;
$$;

-- Helper function: Get course_id from material
CREATE OR REPLACE FUNCTION public.get_material_course_id(check_material_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result_course_id UUID;
BEGIN
  SELECT course_id INTO result_course_id
  FROM public.materials WHERE id = check_material_id;
  RETURN result_course_id;
END;
$$;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_materials_updated_at BEFORE UPDATE ON public.materials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_student_documents_updated_at BEFORE UPDATE ON public.student_documents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to create profile on signup
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citations ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
CREATE POLICY "Users can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- COURSES POLICIES
CREATE POLICY "Enrolled users and lecturers can view courses"
ON public.courses FOR SELECT
TO authenticated
USING (
  public.is_enrolled(auth.uid(), id) OR 
  public.is_lecturer(auth.uid())
);

CREATE POLICY "Lecturers can create courses"
ON public.courses FOR INSERT
TO authenticated
WITH CHECK (public.is_lecturer(auth.uid()));

CREATE POLICY "Course lecturers can update their courses"
ON public.courses FOR UPDATE
TO authenticated
USING (public.is_course_lecturer(auth.uid(), id));

CREATE POLICY "Course lecturers can delete their courses"
ON public.courses FOR DELETE
TO authenticated
USING (public.is_course_lecturer(auth.uid(), id));

-- ENROLLMENTS POLICIES
CREATE POLICY "Users can view their own enrollments"
ON public.enrollments FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id OR
  public.is_course_lecturer(auth.uid(), course_id)
);

CREATE POLICY "Lecturers can manage enrollments"
ON public.enrollments FOR INSERT
TO authenticated
WITH CHECK (public.is_course_lecturer(auth.uid(), course_id));

CREATE POLICY "Lecturers can remove enrollments"
ON public.enrollments FOR DELETE
TO authenticated
USING (public.is_course_lecturer(auth.uid(), course_id));

-- MATERIALS POLICIES
CREATE POLICY "Enrolled users and lecturers can view materials"
ON public.materials FOR SELECT
TO authenticated
USING (
  public.is_enrolled(auth.uid(), course_id) OR
  public.is_course_lecturer(auth.uid(), course_id)
);

CREATE POLICY "Lecturers can upload materials"
ON public.materials FOR INSERT
TO authenticated
WITH CHECK (public.is_course_lecturer(auth.uid(), course_id));

CREATE POLICY "Lecturers can update materials"
ON public.materials FOR UPDATE
TO authenticated
USING (public.is_course_lecturer(auth.uid(), course_id));

CREATE POLICY "Lecturers can delete materials"
ON public.materials FOR DELETE
TO authenticated
USING (public.is_course_lecturer(auth.uid(), course_id));

-- STUDENT_DOCUMENTS POLICIES
CREATE POLICY "Students can view own documents"
ON public.student_documents FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Students can upload documents"
ON public.student_documents FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Students can update own documents"
ON public.student_documents FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Students can delete own documents"
ON public.student_documents FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- CHUNKS POLICIES
CREATE POLICY "Users can view course chunks"
ON public.chunks FOR SELECT
TO authenticated
USING (
  (material_id IS NOT NULL AND (
    public.is_enrolled(auth.uid(), public.get_material_course_id(material_id)) OR
    public.is_course_lecturer(auth.uid(), public.get_material_course_id(material_id))
  )) OR
  (student_document_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.student_documents sd
    WHERE sd.id = student_document_id AND sd.user_id = auth.uid()
  ))
);

-- CONVERSATIONS POLICIES
CREATE POLICY "Users can view own conversations"
ON public.conversations FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create conversations"
ON public.conversations FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id AND
  public.is_enrolled(auth.uid(), course_id)
);

CREATE POLICY "Users can update own conversations"
ON public.conversations FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
ON public.conversations FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- MESSAGES POLICIES
CREATE POLICY "Users can view messages in own conversations"
ON public.messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create messages in own conversations"
ON public.messages FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.user_id = auth.uid()
  )
);

-- CITATIONS POLICIES
CREATE POLICY "Users can view citations for own messages"
ON public.citations FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = message_id AND c.user_id = auth.uid()
  )
);

-- Create storage buckets for files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('course-materials', 'course-materials', false);

INSERT INTO storage.buckets (id, name, public) 
VALUES ('student-documents', 'student-documents', false);

-- Storage policies for course-materials bucket
CREATE POLICY "Lecturers can upload course materials"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'course-materials' AND
  public.is_lecturer(auth.uid())
);

CREATE POLICY "Enrolled users can view course materials"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'course-materials'
);

CREATE POLICY "Lecturers can delete course materials"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'course-materials' AND
  public.is_lecturer(auth.uid())
);

-- Storage policies for student-documents bucket
CREATE POLICY "Students can upload own documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'student-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Students can view own documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'student-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Students can delete own documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'student-documents' AND
  (storage.foldername(name))[1] = auth.uid()::text
);