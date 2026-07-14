export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

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
          sort_key: number | null
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
          sort_key?: number | null
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
          sort_key?: number | null
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
      course_invites: {
        Row: {
          course_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          invite_code: string
          invited_email: string | null
          is_course_code: boolean
          redeemed_at: string | null
          redeemed_by: string | null
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          invite_code: string
          invited_email?: string | null
          is_course_code?: boolean
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          invite_code?: string
          invited_email?: string | null
          is_course_code?: boolean
          redeemed_at?: string | null
          redeemed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_invites_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      material_processing_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          material_id: string
          payload: Json
          status: Database["public"]["Enums"]["processing_status"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          job_type: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          material_id: string
          payload?: Json
          status?: Database["public"]["Enums"]["processing_status"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          material_id?: string
          payload?: Json
          status?: Database["public"]["Enums"]["processing_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_processing_jobs_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
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
      materials: {
        Row: {
          academic_term_id: string
          access_scope: Database["public"]["Enums"]["material_access_scope"]
          course_id: string
          created_at: string
          duration_ms: number | null
          external_transcript_id: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: Database["public"]["Enums"]["document_type"]
          id: string
          is_public: boolean
          linked_url: string | null
          processing_error: string | null
          processing_progress: number | null
          processing_stage: string | null
          processing_status: Database["public"]["Enums"]["processing_status"]
          thumbnail_path: string | null
          topic: string | null
          transcription_language: string | null
          transcription_provider: string | null
          updated_at: string
          uploaded_by: string | null
          week_number: number | null
        }
        Insert: {
          academic_term_id: string
          access_scope?: Database["public"]["Enums"]["material_access_scope"]
          course_id: string
          created_at?: string
          duration_ms?: number | null
          external_transcript_id?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          is_public?: boolean
          linked_url?: string | null
          processing_error?: string | null
          processing_progress?: number | null
          processing_stage?: string | null
          processing_status?: Database["public"]["Enums"]["processing_status"]
          thumbnail_path?: string | null
          topic?: string | null
          transcription_language?: string | null
          transcription_provider?: string | null
          updated_at?: string
          uploaded_by?: string | null
          week_number?: number | null
        }
        Update: {
          academic_term_id?: string
          access_scope?: Database["public"]["Enums"]["material_access_scope"]
          course_id?: string
          created_at?: string
          duration_ms?: number | null
          external_transcript_id?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          is_public?: boolean
          linked_url?: string | null
          processing_error?: string | null
          processing_progress?: number | null
          processing_stage?: string | null
          processing_status?: Database["public"]["Enums"]["processing_status"]
          thumbnail_path?: string | null
          topic?: string | null
          transcription_language?: string | null
          transcription_provider?: string | null
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
      organization_members: {
        Row: {
          created_at: string
          org_id: string
          org_role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          org_role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          org_role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          id: string
          is_active: boolean
          max_ai_questions_per_month: number | null
          max_courses: number | null
          max_materials: number | null
          max_seats: number | null
          max_video_minutes_per_month: number | null
          monthly_price_cents: number | null
          name: string
          sort_order: number
          stripe_price_id: string | null
        }
        Insert: {
          id: string
          is_active?: boolean
          max_ai_questions_per_month?: number | null
          max_courses?: number | null
          max_materials?: number | null
          max_seats?: number | null
          max_video_minutes_per_month?: number | null
          monthly_price_cents?: number | null
          name: string
          sort_order?: number
          stripe_price_id?: string | null
        }
        Update: {
          id?: string
          is_active?: boolean
          max_ai_questions_per_month?: number | null
          max_courses?: number | null
          max_materials?: number | null
          max_seats?: number | null
          max_video_minutes_per_month?: number | null
          monthly_price_cents?: number | null
          name?: string
          sort_order?: number
          stripe_price_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          course_enrolled: string[]
          created_at: string
          custom_instructions: string | null
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
          custom_instructions?: string | null
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
          custom_instructions?: string | null
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
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          org_id: string
          plan_id: string
          status: string
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          org_id: string
          plan_id: string
          status: string
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          org_id?: string
          plan_id?: string
          status?: string
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          ai_questions: number
          org_id: string
          period_start: string
          updated_at: string
          video_minutes: number
        }
        Insert: {
          ai_questions?: number
          org_id: string
          period_start: string
          updated_at?: string
          video_minutes?: number
        }
        Update: {
          ai_questions?: number
          org_id?: string
          period_start?: string
          updated_at?: string
          video_minutes?: number
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
        Insert: {
          academic_term_id?: string | null
          course_id?: string | null
          created_at?: string | null
          id?: string | null
          query_category?: string | null
          query_text?: string | null
          unresolved_reason?: string | null
        }
        Update: {
          academic_term_id?: string | null
          course_id?: string | null
          created_at?: string | null
          id?: string | null
          query_category?: string | null
          query_text?: string | null
          unresolved_reason?: string | null
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
            foreignKeyName: "query_events_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      claim_material_processing_job: {
        Args: {
          requested_job_type?: string
          requested_material_id?: string
          worker_id: string
        }
        Returns: {
          attempt_count: number
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          material_id: string
          payload: Json
          status: Database["public"]["Enums"]["processing_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "material_processing_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_active_academic_term_id: { Args: never; Returns: string }
      get_course_active_student_count:
        | {
            Args: { in_course_id: string; in_start_at?: string }
            Returns: number
          }
        | {
            Args: {
              in_course_id: string
              in_end_at?: string
              in_start_at?: string
            }
            Returns: number
          }
      get_course_document_reference_stats:
        | {
            Args: { in_course_id: string; in_start_at?: string }
            Returns: {
              file_name: string
              file_type: Database["public"]["Enums"]["document_type"]
              last_referenced_at: string
              material_id: string
              question_count: number
              reference_count: number
              unique_student_count: number
            }[]
          }
        | {
            Args: {
              in_course_id: string
              in_end_at?: string
              in_start_at?: string
            }
            Returns: {
              file_name: string
              file_type: Database["public"]["Enums"]["document_type"]
              last_referenced_at: string
              material_id: string
              question_count: number
              reference_count: number
              unique_student_count: number
            }[]
          }
      get_course_keyword_stats:
        | {
            Args: {
              in_course_id: string
              in_end_at?: string
              in_limit?: number
              in_start_at?: string
            }
            Returns: {
              frequency: number
              keyword: string
            }[]
          }
        | {
            Args: {
              in_course_id: string
              in_limit?: number
              in_start_at?: string
            }
            Returns: {
              frequency: number
              keyword: string
            }[]
          }
      get_course_top_questions:
        | {
            Args: {
              in_course_id: string
              in_end_at?: string
              in_limit?: number
              in_start_at?: string
            }
            Returns: {
              frequency: number
              last_asked_at: string
              question: string
              unique_student_count: number
            }[]
          }
        | {
            Args: {
              in_course_id: string
              in_limit?: number
              in_start_at?: string
            }
            Returns: {
              frequency: number
              last_asked_at: string
              question: string
              unique_student_count: number
            }[]
          }
      get_material_course_id: {
        Args: { check_material_id: string }
        Returns: string
      }
      get_org_entitlements: {
        Args: { check_org_id: string }
        Returns: {
          ai_questions_used: number
          cancel_at_period_end: boolean
          courses_used: number
          current_period_end: string
          materials_used: number
          max_ai_questions_per_month: number
          max_courses: number
          max_materials: number
          max_seats: number
          max_video_minutes_per_month: number
          plan_id: string
          plan_name: string
          seats_used: number
          status: string
          trial_ends_at: string
          video_minutes_used: number
        }[]
      }
      increment_usage_if_allowed: {
        Args: { amount?: number; check_org_id: string; kind: string }
        Returns: boolean
      }
      is_admin: { Args: { check_user_id: string }; Returns: boolean }
      is_course_lecturer: {
        Args: { check_course_id: string; check_user_id: string }
        Returns: boolean
      }
      is_enrolled: {
        Args: { check_course_id: string; check_user_id: string }
        Returns: boolean
      }
      is_lecturer: { Args: { check_user_id: string }; Returns: boolean }
      is_org_member: {
        Args: { check_org_id: string; check_user_id: string }
        Returns: boolean
      }
      is_org_owner: {
        Args: { check_org_id: string; check_user_id: string }
        Returns: boolean
      }
      list_accessible_courses: {
        Args: never
        Returns: {
          access_role: string
          code: string
          id: string
          name: string
        }[]
      }
      match_chunks:
        | {
            Args: {
              match_count?: number
              match_threshold?: number
              query_embedding: string
              user_id?: string
            }
            Returns: {
              chunk_text: string
              document_name: string
              document_type: string
              id: string
              material_id: string
              material_name: string
              material_type: string
              page_number: number
              relevance_score: number
              student_document_id: string
            }[]
          }
        | {
            Args: {
              course_id_filter?: string
              match_count?: number
              match_threshold?: number
              query_embedding: string
              user_id?: string
            }
            Returns: {
              chunk_text: string
              document_name: string
              document_type: string
              end_ms: number
              id: string
              material_id: string
              material_name: string
              material_type: string
              page_number: number
              relevance_score: number
              start_ms: number
              student_document_id: string
            }[]
          }
        | {
            Args: {
              course_id_filter?: string
              match_count?: number
              match_threshold?: number
              query_embedding: string
              selected_material_ids?: string[]
              user_id?: string
            }
            Returns: {
              chunk_text: string
              document_name: string
              document_type: string
              end_ms: number
              id: string
              material_id: string
              material_name: string
              material_type: string
              page_number: number
              relevance_score: number
              start_ms: number
              student_document_id: string
            }[]
          }
      org_has_active_subscription: {
        Args: { check_org_id: string }
        Returns: boolean
      }
      reap_stale_material_jobs: { Args: never; Returns: number }
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
          sort_key: number | null
          starts_on: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "academic_terms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sync_profile_course_enrolled: {
        Args: { target_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      document_type:
        | "pdf"
        | "transcript"
        | "code"
        | "slides"
        | "notes"
        | "other"
        | "image"
        | "docx"
        | "pptx"
        | "video"
      material_access_scope: "course" | "public" | "private"
      org_role: "owner" | "admin" | "member"
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
      document_type: [
        "pdf",
        "transcript",
        "code",
        "slides",
        "notes",
        "other",
        "image",
        "docx",
        "pptx",
        "video",
      ],
      material_access_scope: ["course", "public", "private"],
      org_role: ["owner", "admin", "member"],
      processing_status: ["pending", "processing", "completed", "failed"],
      user_role: ["student", "admin"],
    },
  },
} as const
