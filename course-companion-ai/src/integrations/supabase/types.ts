export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// Trigger redeployment  
export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      academic_terms: {
        Row: {
          academic_year_end: number
          academic_year_start: number
          created_at: string
          ends_on: string | null
          id: string
          is_active: boolean
          label: string
          semester: number
          sort_key: number
          starts_on: string | null
          updated_at: string
        }
        Insert: {
          academic_year_end: number
          academic_year_start: number
          created_at?: string
          ends_on?: string | null
          id?: string
          is_active?: boolean
          label: string
          semester: number
          starts_on?: string | null
          updated_at?: string
        }
        Update: {
          academic_year_end?: number
          academic_year_start?: number
          created_at?: string
          ends_on?: string | null
          id?: string
          is_active?: boolean
          label?: string
          semester?: number
          starts_on?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          created_at: string
          embedding: string | null
          end_ms: number | null
          end_position: number | null
          id: string
          material_id: string | null
          metadata: Json | null
          page_number: number | null
          start_ms: number | null
          start_position: number | null
          student_document_id: string | null
        }
        Insert: {
          chunk_index: number
          chunk_text: string
          created_at?: string
          embedding?: string | null
          end_ms?: number | null
          end_position?: number | null
          id?: string
          material_id?: string | null
          metadata?: Json | null
          page_number?: number | null
          start_ms?: number | null
          start_position?: number | null
          student_document_id?: string | null
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          embedding?: string | null
          end_ms?: number | null
          end_position?: number | null
          id?: string
          material_id?: string | null
          metadata?: Json | null
          page_number?: number | null
          start_ms?: number | null
          start_position?: number | null
          student_document_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chunks_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_student_document_id_fkey"
            columns: ["student_document_id"]
            isOneToOne: false
            referencedRelation: "student_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      citations: {
        Row: {
          chunk_id: string
          created_at: string
          excerpt: string | null
          id: string
          message_id: string
          relevance_score: number | null
        }
        Insert: {
          chunk_id: string
          created_at?: string
          excerpt?: string | null
          id?: string
          message_id: string
          relevance_score?: number | null
        }
        Update: {
          chunk_id?: string
          created_at?: string
          excerpt?: string | null
          id?: string
          message_id?: string
          relevance_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "citations_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citations_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          course_id: string
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          course_id: string
          enrolled_at: string
          id: string
          user_id: string
        }
        Insert: {
          course_id: string
          enrolled_at?: string
          id?: string
          user_id: string
        }
        Update: {
          course_id?: string
          enrolled_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          access_scope: Database["public"]["Enums"]["material_access_scope"]
          academic_term_id: string
          course_id: string
          created_at: string
          duration_ms: number | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: Database["public"]["Enums"]["document_type"]
          id: string
          is_public: boolean
          processing_error: string | null
          processing_progress: number | null
          processing_stage: string | null
          processing_status: Database["public"]["Enums"]["processing_status"]
          thumbnail_path: string | null
          transcription_language: string | null
          transcription_provider: string | null
          topic: string | null
          updated_at: string
          uploaded_by: string | null
          week_number: number | null
        }
        Insert: {
          access_scope?: Database["public"]["Enums"]["material_access_scope"]
          academic_term_id?: string
          course_id: string
          created_at?: string
          duration_ms?: number | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          is_public?: boolean
          processing_error?: string | null
          processing_progress?: number | null
          processing_stage?: string | null
          processing_status?: Database["public"]["Enums"]["processing_status"]
          thumbnail_path?: string | null
          transcription_language?: string | null
          transcription_provider?: string | null
          topic?: string | null
          updated_at?: string
          uploaded_by?: string | null
          week_number?: number | null
        }
        Update: {
          access_scope?: Database["public"]["Enums"]["material_access_scope"]
          academic_term_id?: string
          course_id?: string
          created_at?: string
          duration_ms?: number | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          is_public?: boolean
          processing_error?: string | null
          processing_progress?: number | null
          processing_stage?: string | null
          processing_status?: Database["public"]["Enums"]["processing_status"]
          thumbnail_path?: string | null
          transcription_language?: string | null
          transcription_provider?: string | null
          topic?: string | null
          updated_at?: string
          uploaded_by?: string | null
          week_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "materials_academic_term_id_fkey"
            columns: ["academic_term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      material_transcript_segments: {
        Row: {
          confidence: number | null
          created_at: string
          end_ms: number
          id: string
          material_id: string
          segment_index: number
          speaker_label: string | null
          start_ms: number
          text: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          end_ms: number
          id?: string
          material_id: string
          segment_index: number
          speaker_label?: string | null
          start_ms: number
          text: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          end_ms?: number
          id?: string
          material_id?: string
          segment_index?: number
          speaker_label?: string | null
          start_ms?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_transcript_segments_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          course_enrolled: string[]
          created_at: string
          email: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          course_enrolled?: string[]
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          course_enrolled?: string[]
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      query_events: {
        Row: {
          academic_term_id: string | null
          assistant_message_id: string | null
          citation_count: number
          citation_hit: boolean
          conversation_id: string | null
          course_id: string | null
          created_at: string
          id: string
          latency_ms: number | null
          query_category: string
          query_text: string
          retrieved_chunk_count: number
          unresolved: boolean
          unresolved_reason: string | null
          user_id: string
          user_message_id: string | null
        }
        Insert: {
          academic_term_id?: string | null
          assistant_message_id?: string | null
          citation_count?: number
          citation_hit?: boolean
          conversation_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          latency_ms?: number | null
          query_category?: string
          query_text: string
          retrieved_chunk_count?: number
          unresolved?: boolean
          unresolved_reason?: string | null
          user_id: string
          user_message_id?: string | null
        }
        Update: {
          academic_term_id?: string | null
          assistant_message_id?: string | null
          citation_count?: number
          citation_hit?: boolean
          conversation_id?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          latency_ms?: number | null
          query_category?: string
          query_text?: string
          retrieved_chunk_count?: number
          unresolved?: boolean
          unresolved_reason?: string | null
          user_id?: string
          user_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "query_events_academic_term_id_fkey"
            columns: ["academic_term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "query_events_assistant_message_id_fkey"
            columns: ["assistant_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "query_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "query_events_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "query_events_user_message_id_fkey"
            columns: ["user_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      student_documents: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: Database["public"]["Enums"]["document_type"]
          id: string
          processing_error: string | null
          processing_status: Database["public"]["Enums"]["processing_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          processing_error?: string | null
          processing_status?: Database["public"]["Enums"]["processing_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          processing_error?: string | null
          processing_status?: Database["public"]["Enums"]["processing_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      analytics_query_category_stats: {
        Row: {
          citation_hit_count: number | null
          citation_hit_rate: number | null
          query_category: string | null
          query_count: number | null
          unresolved_count: number | null
        }
        Relationships: []
      }
      analytics_recent_unresolved_queries: {
        Row: {
          academic_term_id: string | null
          course_id: string | null
          created_at: string | null
          id: string | null
          query_category: string | null
          query_text: string | null
          unresolved_reason: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_course_document_reference_stats: {
        Args: { in_course_id: string; in_start_at?: string | null }
        Returns: {
          file_name: string
          file_type: Database["public"]["Enums"]["document_type"]
          last_referenced_at: string | null
          material_id: string
          question_count: number
          reference_count: number
          unique_student_count: number
        }[]
      }
      get_course_keyword_stats: {
        Args: { in_course_id: string; in_limit?: number; in_start_at?: string | null }
        Returns: {
          frequency: number
          keyword: string
        }[]
      }
      get_course_top_questions: {
        Args: { in_course_id: string; in_limit?: number; in_start_at?: string | null }
        Returns: {
          frequency: number
          last_asked_at: string | null
          question: string
          unique_student_count: number
        }[]
      }
      get_active_academic_term_id: {
        Args: Record<PropertyKey, never>
        Returns: string | null
      }
      get_material_course_id: {
        Args: { check_material_id: string }
        Returns: string
      }
      is_admin: { Args: { check_user_id: string }; Returns: boolean }
      is_enrolled: {
        Args: { check_course_id: string; check_user_id: string }
        Returns: boolean
      }
      list_accessible_courses: {
        Args: Record<PropertyKey, never>
        Returns: {
          access_role: string
          code: string | null
          id: string
          name: string
        }[]
      }
      match_chunks: {
        Args: {
          course_id_filter?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
          user_id?: string
        }
        Returns: {
          chunk_text: string
          document_name: string | null
          document_type: string | null
          end_ms: number | null
          id: string
          material_id: string | null
          material_name: string | null
          material_type: string | null
          page_number: number | null
          relevance_score: number
          start_ms: number | null
          student_document_id: string | null
        }[]
      }
      set_active_academic_term: {
        Args: { target_term_id: string }
        Returns: {
          academic_year_end: number
          academic_year_start: number
          created_at: string
          ends_on: string | null
          id: string
          is_active: boolean
          label: string
          semester: number
          sort_key: number
          starts_on: string | null
          updated_at: string
        }
      }
    }
    Enums: {
      document_type:
        | "pdf"
        | "transcript"
        | "code"
        | "slides"
        | "notes"
        | "video"
        | "other"
      material_access_scope: "course" | "public" | "private"
      processing_status: "pending" | "processing" | "completed" | "failed"
      user_role: "student" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      document_type: ["pdf", "transcript", "code", "slides", "notes", "video", "other"],
      material_access_scope: ["course", "public", "private"],
      processing_status: ["pending", "processing", "completed", "failed"],
      user_role: ["student", "admin"],
    },
  },
} as const
