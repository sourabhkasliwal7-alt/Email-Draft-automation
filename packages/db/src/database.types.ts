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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor: string
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          payload: Json
          updated_at: string
        }
        Insert: {
          action: string
          actor?: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          payload?: Json
          updated_at?: string
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      campaign_leads: {
        Row: {
          campaign_id: string
          case_study_id: string | null
          contact_id: string
          created_at: string
          icp_segment: string | null
          id: string
          last_contact_date: string | null
          lead_score: number | null
          lead_source: string | null
          next_action: string | null
          next_action_date: string | null
          nurture_date: string | null
          offer_id: string | null
          opportunity_value: number | null
          owner_id: string | null
          reason_codes: string[]
          review_required: boolean
          score_components: Json
          status: string
          trigger: string | null
          trigger_date: string | null
          trigger_source: string | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          case_study_id?: string | null
          contact_id: string
          created_at?: string
          icp_segment?: string | null
          id?: string
          last_contact_date?: string | null
          lead_score?: number | null
          lead_source?: string | null
          next_action?: string | null
          next_action_date?: string | null
          nurture_date?: string | null
          offer_id?: string | null
          opportunity_value?: number | null
          owner_id?: string | null
          reason_codes?: string[]
          review_required?: boolean
          score_components?: Json
          status?: string
          trigger?: string | null
          trigger_date?: string | null
          trigger_source?: string | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          case_study_id?: string | null
          contact_id?: string
          created_at?: string
          icp_segment?: string | null
          id?: string
          last_contact_date?: string | null
          lead_score?: number | null
          lead_source?: string | null
          next_action?: string | null
          next_action_date?: string | null
          nurture_date?: string | null
          offer_id?: string | null
          opportunity_value?: number | null
          owner_id?: string | null
          reason_codes?: string[]
          review_required?: boolean
          score_components?: Json
          status?: string
          trigger?: string | null
          trigger_date?: string | null
          trigger_source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_leads_case_study_id_fkey"
            columns: ["case_study_id"]
            isOneToOne: false
            referencedRelation: "case_studies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          cta: string | null
          daily_cap: number
          deleted_at: string | null
          icp: Json
          id: string
          inbox_id: string | null
          name: string
          offer_id: string | null
          regions: string[]
          research_depth: string
          score_draft_min: number
          score_review_min: number
          send_window: Json
          status: string
          target_roles: string[]
          tone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          cta?: string | null
          daily_cap?: number
          deleted_at?: string | null
          icp?: Json
          id?: string
          inbox_id?: string | null
          name: string
          offer_id?: string | null
          regions?: string[]
          research_depth?: string
          score_draft_min?: number
          score_review_min?: number
          send_window?: Json
          status?: string
          target_roles?: string[]
          tone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          cta?: string | null
          daily_cap?: number
          deleted_at?: string | null
          icp?: Json
          id?: string
          inbox_id?: string | null
          name?: string
          offer_id?: string | null
          regions?: string[]
          research_depth?: string
          score_draft_min?: number
          score_review_min?: number
          send_window?: Json
          status?: string
          target_roles?: string[]
          tone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      case_studies: {
        Row: {
          allowed_numbers: Json
          created_at: string
          deleted_at: string | null
          id: string
          industries: string[]
          offer_id: string | null
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          allowed_numbers?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          industries?: string[]
          offer_id?: string | null
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          allowed_numbers?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          industries?: string[]
          offer_id?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_studies_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          country: string | null
          created_at: string
          domain: string
          employee_count: number | null
          id: string
          industry: string | null
          name: string | null
          research_cached_at: string | null
          summary: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          domain: string
          employee_count?: number | null
          id?: string
          industry?: string | null
          name?: string | null
          research_cached_at?: string | null
          summary?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          domain?: string
          employee_count?: number | null
          id?: string
          industry?: string | null
          name?: string | null
          research_cached_at?: string | null
          summary?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company_id: string | null
          company_name: string | null
          country: string | null
          created_at: string
          dnc: boolean
          email: string | null
          email_lower: string | null
          email_status: string
          first_name: string | null
          full_name: string | null
          id: string
          job_title: string | null
          last_name: string | null
          profile_url: string | null
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          dnc?: boolean
          email?: string | null
          email_lower?: string | null
          email_status?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          profile_url?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          dnc?: boolean
          email?: string | null
          email_lower?: string | null
          email_status?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          profile_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_drafts: {
        Row: {
          body_hash: string | null
          body_html: string | null
          body_text: string
          campaign_lead_id: string
          claim_check: Json
          created_at: string
          facts: Json
          gmail_draft_id: string | null
          gmail_message_id_header: string | null
          id: string
          idempotency_key: string
          inbox_id: string | null
          quality_score: number | null
          status: string
          step: number
          subject: string
          updated_at: string
          version: number
          warnings: string[]
        }
        Insert: {
          body_hash?: string | null
          body_html?: string | null
          body_text: string
          campaign_lead_id: string
          claim_check?: Json
          created_at?: string
          facts?: Json
          gmail_draft_id?: string | null
          gmail_message_id_header?: string | null
          id?: string
          idempotency_key: string
          inbox_id?: string | null
          quality_score?: number | null
          status?: string
          step?: number
          subject: string
          updated_at?: string
          version?: number
          warnings?: string[]
        }
        Update: {
          body_hash?: string | null
          body_html?: string | null
          body_text?: string
          campaign_lead_id?: string
          claim_check?: Json
          created_at?: string
          facts?: Json
          gmail_draft_id?: string | null
          gmail_message_id_header?: string | null
          id?: string
          idempotency_key?: string
          inbox_id?: string | null
          quality_score?: number | null
          status?: string
          step?: number
          subject?: string
          updated_at?: string
          version?: number
          warnings?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "email_drafts_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_drafts_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sends: {
        Row: {
          attempt: number
          body_text: string
          campaign_id: string | null
          company: string | null
          created_at: string
          draft_id: string
          failure_reason: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          inbox_id: string
          recipient_email: string
          recipient_name: string | null
          send_key: string
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          body_text: string
          campaign_id?: string | null
          company?: string | null
          created_at?: string
          draft_id: string
          failure_reason?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          inbox_id: string
          recipient_email: string
          recipient_name?: string | null
          send_key: string
          sent_at?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          body_text?: string
          campaign_id?: string | null
          company?: string | null
          created_at?: string
          draft_id?: string
          failure_reason?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          inbox_id?: string
          recipient_email?: string
          recipient_name?: string | null
          send_key?: string
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "email_sends_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "email_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          apollo_person_id: string | null
          batch_id: string | null
          campaign_lead_id: string | null
          contact_id: string
          created_at: string
          credits: number
          error: string | null
          finished_at: string | null
          flags: Json
          id: string
          is_mock: boolean
          provider: string
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          apollo_person_id?: string | null
          batch_id?: string | null
          campaign_lead_id?: string | null
          contact_id: string
          created_at?: string
          credits?: number
          error?: string | null
          finished_at?: string | null
          flags?: Json
          id?: string
          is_mock?: boolean
          provider?: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          apollo_person_id?: string | null
          batch_id?: string | null
          campaign_lead_id?: string | null
          contact_id?: string
          created_at?: string
          credits?: number
          error?: string | null
          finished_at?: string | null
          flags?: Json
          id?: string
          is_mock?: boolean
          provider?: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "pipeline_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          }
        ]
      }
      enrichment_results: {
        Row: {
          contact_id: string
          created_at: string
          credits_used: number
          id: string
          provider: string
          result: Json
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          credits_used?: number
          id?: string
          provider: string
          result?: Json
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          credits_used?: number
          id?: string
          provider?: string
          result?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_results_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_items: {
        Row: {
          company_id: string
          confidence: number | null
          created_at: string
          id: string
          research_run_id: string | null
          retrieved_at: string
          snippet: string | null
          source_type: string
          title: string | null
          updated_at: string
          url: string
        }
        Insert: {
          company_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          research_run_id?: string | null
          retrieved_at?: string
          snippet?: string | null
          source_type?: string
          title?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          company_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          research_run_id?: string | null
          retrieved_at?: string
          snippet?: string | null
          source_type?: string
          title?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_items_research_run_id_fkey"
            columns: ["research_run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      followups: {
        Row: {
          campaign_lead_id: string
          created_at: string
          due_date: string
          id: string
          status: string
          step: number
          updated_at: string
        }
        Insert: {
          campaign_lead_id: string
          created_at?: string
          due_date: string
          id?: string
          status?: string
          step: number
          updated_at?: string
        }
        Update: {
          campaign_lead_id?: string
          created_at?: string
          due_date?: string
          id?: string
          status?: string
          step?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "followups_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          campaign_id: string | null
          created_at: string
          dry_run: boolean
          error: string | null
          file_hash: string
          file_name: string
          file_size: number | null
          id: string
          mapping: Json
          mode: string
          runs: number
          sheet: string | null
          status: string
          storage_path: string | null
          totals: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          dry_run?: boolean
          error?: string | null
          file_hash: string
          file_name: string
          file_size?: number | null
          id?: string
          mapping?: Json
          mode?: string
          runs?: number
          sheet?: string | null
          status?: string
          storage_path?: string | null
          totals?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          dry_run?: boolean
          error?: string | null
          file_hash?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mapping?: Json
          mode?: string
          runs?: number
          sheet?: string | null
          status?: string
          storage_path?: string | null
          totals?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      import_rows: {
        Row: {
          batch_id: string
          contact_id: string | null
          created_at: string
          errors: string[]
          id: string
          normalized: Json | null
          original: Json
          row_number: number
          status: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          contact_id?: string | null
          created_at?: string
          errors?: string[]
          id?: string
          normalized?: Json | null
          original: Json
          row_number: number
          status?: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          contact_id?: string | null
          created_at?: string
          errors?: string[]
          id?: string
          normalized?: Json | null
          original?: Json
          row_number?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      import_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          mapping: Json
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          mapping: Json
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          mapping?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      inboxes: {
        Row: {
          created_at: string
          daily_draft_cap: number
          daily_send_cap: number
          deleted_at: string | null
          display_name: string | null
          email: string
          email_lower: string | null
          encrypted_refresh_token: string | null
          id: string
          last_health_check: string | null
          min_seconds_between_sends: number
          scopes: string[]
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_draft_cap?: number
          daily_send_cap?: number
          deleted_at?: string | null
          display_name?: string | null
          email: string
          email_lower?: string | null
          encrypted_refresh_token?: string | null
          id?: string
          last_health_check?: string | null
          min_seconds_between_sends?: number
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_draft_cap?: number
          daily_send_cap?: number
          deleted_at?: string | null
          display_name?: string | null
          email?: string
          email_lower?: string | null
          encrypted_refresh_token?: string | null
          id?: string
          last_health_check?: string | null
          min_seconds_between_sends?: number
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      job_steps: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          job_id: string
          output: Json
          output_ref: string | null
          started_at: string | null
          status: string
          step: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          job_id: string
          output?: Json
          output_ref?: string | null
          started_at?: string | null
          status?: string
          step: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          job_id?: string
          output?: Json
          output_ref?: string | null
          started_at?: string | null
          status?: string
          step?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_steps_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          batch_id: string | null
          campaign_id: string | null
          campaign_lead_id: string | null
          created_at: string
          dispatched_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          payload: Json
          queue_job_id: string | null
          result: Json
          run_after: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          batch_id?: string | null
          campaign_id?: string | null
          campaign_lead_id?: string | null
          created_at?: string
          dispatched_at?: string | null
          id?: string
          idempotency_key: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          payload?: Json
          queue_job_id?: string | null
          result?: Json
          run_after?: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          batch_id?: string | null
          campaign_id?: string | null
          campaign_lead_id?: string | null
          created_at?: string
          dispatched_at?: string | null
          id?: string
          idempotency_key?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          payload?: Json
          queue_job_id?: string | null
          result?: Json
          run_after?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "pipeline_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "jobs_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_events: {
        Row: {
          actor: string
          campaign_lead_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          payload: Json
          type: string
          updated_at: string
        }
        Insert: {
          actor?: string
          campaign_lead_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          type: string
          updated_at?: string
        }
        Update: {
          actor?: string
          campaign_lead_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          allowed_claims: string[]
          created_at: string
          cta_options: string[]
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          allowed_claims?: string[]
          created_at?: string
          cta_options?: string[]
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          allowed_claims?: string[]
          created_at?: string
          cta_options?: string[]
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_batches: {
        Row: {
          campaign_id: string
          created_at: string
          estimate: Json
          fanout_done: boolean
          finished_at: string | null
          id: string
          label: string | null
          pause_detail: Json
          pause_reason: string | null
          paused_at: string | null
          started_at: string
          started_by: string | null
          status: string
          totals: Json
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          estimate?: Json
          fanout_done?: boolean
          finished_at?: string | null
          id?: string
          label?: string | null
          pause_detail?: Json
          pause_reason?: string | null
          paused_at?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          totals?: Json
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          estimate?: Json
          fanout_done?: boolean
          finished_at?: string | null
          id?: string
          label?: string | null
          pause_detail?: Json
          pause_reason?: string | null
          paused_at?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          totals?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_batches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_batches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      price_table: {
        Row: {
          created_at: string
          effective_from: string
          id: string
          provider: string
          unit: string
          updated_at: string
          usd_per_unit: number
        }
        Insert: {
          created_at?: string
          effective_from?: string
          id?: string
          provider: string
          unit: string
          updated_at?: string
          usd_per_unit: number
        }
        Update: {
          created_at?: string
          effective_from?: string
          id?: string
          provider?: string
          unit?: string
          updated_at?: string
          usd_per_unit?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          disabled: boolean
          full_name: string | null
          id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          disabled?: boolean
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          disabled?: boolean
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      replies: {
        Row: {
          created_at: string
          gmail_message_id: string | null
          id: string
          kind: string
          received_at: string
          send_id: string
          snippet: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          gmail_message_id?: string | null
          id?: string
          kind: string
          received_at?: string
          send_id: string
          snippet?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          gmail_message_id?: string | null
          id?: string
          kind?: string
          received_at?: string
          send_id?: string
          snippet?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "replies_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "email_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      research_runs: {
        Row: {
          campaign_lead_id: string | null
          company_id: string
          created_at: string
          depth: string
          error: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          provider: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          campaign_lead_id?: string | null
          company_id: string
          created_at?: string
          depth?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          provider?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          campaign_lead_id?: string | null
          company_id?: string
          created_at?: string
          depth?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          provider?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_runs_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      send_approvals: {
        Row: {
          approved_at: string
          approved_by: string
          batch_label: string | null
          body_hash: string | null
          created_at: string
          draft_id: string
          id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          batch_label?: string | null
          body_hash?: string | null
          created_at?: string
          draft_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          batch_label?: string | null
          body_hash?: string | null
          created_at?: string
          draft_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "send_approvals_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: true
            referencedRelation: "email_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      signals: {
        Row: {
          company_id: string
          confidence: number | null
          created_at: string
          description: string
          evidence_item_id: string | null
          id: string
          provider: string | null
          retrieved_at: string
          signal_date: string | null
          source_name: string | null
          source_url: string | null
          type: string
          updated_at: string
          verification: string
        }
        Insert: {
          company_id: string
          confidence?: number | null
          created_at?: string
          description: string
          evidence_item_id?: string | null
          id?: string
          provider?: string | null
          retrieved_at?: string
          signal_date?: string | null
          source_name?: string | null
          source_url?: string | null
          type: string
          updated_at?: string
          verification?: string
        }
        Update: {
          company_id?: string
          confidence?: number | null
          created_at?: string
          description?: string
          evidence_item_id?: string | null
          id?: string
          provider?: string | null
          retrieved_at?: string
          signal_date?: string | null
          source_name?: string | null
          source_url?: string | null
          type?: string
          updated_at?: string
          verification?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_evidence_item_id_fkey"
            columns: ["evidence_item_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
        ]
      }
      spend_caps: {
        Row: {
          campaign_id: string | null
          cap_usd: number
          created_at: string
          id: string
          period: string
          provider: string | null
          scope: string
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          cap_usd: number
          created_at?: string
          id?: string
          period: string
          provider?: string | null
          scope?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          cap_usd?: number
          created_at?: string
          id?: string
          period?: string
          provider?: string | null
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spend_caps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spend_caps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      suppression: {
        Row: {
          campaign_id: string | null
          created_at: string
          domain: string | null
          email_lower: string | null
          id: string
          reason: string
          scope: string
          source: string
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          domain?: string | null
          email_lower?: string | null
          id?: string
          reason: string
          scope?: string
          source?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          domain?: string | null
          email_lower?: string | null
          id?: string
          reason?: string
          scope?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppression_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppression_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      usage_records: {
        Row: {
          campaign_id: string | null
          campaign_lead_id: string | null
          cost_usd: number
          created_at: string
          id: string
          idempotency_key: string | null
          is_mock: boolean
          job_id: string | null
          operation: string
          provider: string
          status: string
          step: string | null
          units: Json
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          campaign_lead_id?: string | null
          cost_usd?: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          is_mock?: boolean
          job_id?: string | null
          operation: string
          provider: string
          status?: string
          step?: string | null
          units?: Json
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          campaign_lead_id?: string | null
          cost_usd?: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          is_mock?: boolean
          job_id?: string | null
          operation?: string
          provider?: string
          status?: string
          step?: string | null
          units?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_records_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "usage_records_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_heartbeats: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          meta: Json
          updated_at: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          meta?: Json
          updated_at?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          meta?: Json
          updated_at?: string
          worker_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_campaign_performance: {
        Row: {
          approved_or_later: number | null
          bounces: number | null
          campaign_id: string | null
          cost_usd: number | null
          leads: number | null
          name: string | null
          opt_outs: number | null
          replies: number | null
          sent: number | null
          status: string | null
        }
        Insert: {
          approved_or_later?: never
          bounces?: never
          campaign_id?: string | null
          cost_usd?: never
          leads?: never
          name?: string | null
          opt_outs?: never
          replies?: never
          sent?: never
          status?: string | null
        }
        Update: {
          approved_or_later?: never
          bounces?: never
          campaign_id?: string | null
          cost_usd?: never
          leads?: never
          name?: string | null
          opt_outs?: never
          replies?: never
          sent?: never
          status?: string | null
        }
        Relationships: []
      }
      v_cost_summary: {
        Row: {
          calls: number | null
          campaign_id: string | null
          cost_usd: number | null
          month: string | null
          provider: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_records_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      v_daily_metrics: {
        Row: {
          approvals: number | null
          bounces: number | null
          day: string | null
          drafts_created: number | null
          failed: number | null
          opt_outs: number | null
          replies: number | null
          sent: number | null
        }
        Relationships: []
      }
      v_followups_due: {
        Row: {
          campaign_id: string | null
          campaign_lead_id: string | null
          contact_id: string | null
          due_date: string | null
          email: string | null
          followup_id: string | null
          full_name: string | null
          lead_status: string | null
          step: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_performance"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followups_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
