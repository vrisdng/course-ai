export type Course = {
  id: string;
  name: string;
  code: string | null;
};

export type AcademicTerm = {
  id: string;
  label: string;
  semester: number;
  academic_year_start: number;
  academic_year_end: number;
  sort_key: number;
  is_active: boolean;
};

export type MaterialStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type AccessScope = 'course' | 'public' | 'private';

export type Material = {
  id: string;
  course_id: string;
  duration_ms?: number | null;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number | null;
  linked_url: string | null;
  topic: string | null;
  week_number: number | null;
  processing_error?: string | null;
  processing_progress?: number | null;
  processing_stage?: string | null;
  processing_status: MaterialStatus;
  access_scope: AccessScope;
  academic_term_id: string | null;
  created_at: string;
};

export type TranscriptSegment = {
  id: string;
  segment_index: number;
  start_ms: number;
  end_ms: number;
  text: string;
};

export type UploadOutcome = 'indexed' | 'processing';
