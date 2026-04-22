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
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      booking_equipment: {
        Row: {
          booking_id: number
          created_at: string
          equipment_id: number
          id: number
          quantity: number
          returned_at: string | null
        }
        Insert: {
          booking_id: number
          created_at?: string
          equipment_id: number
          id?: never
          quantity?: number
          returned_at?: string | null
        }
        Update: {
          booking_id?: number
          created_at?: string
          equipment_id?: number
          id?: never
          quantity?: number
          returned_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_equipment_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          addons: Json
          address_verified_by_admin: string | null
          address_verified_date: string | null
          assigned_inventory_items: Json | null
          city: string
          client_secret: string | null
          contact_address: Json | null
          created_at: string
          customer_id: number | null
          damage_photos: Json | null
          delivered_at: string | null
          delivery_address: Json | null
          distance_miles: number
          drop_off_date: string
          drop_off_time_slot: string | null
          email: string
          equipment_status: string | null
          fees: Json | null
          first_name: string | null
          id: number
          is_manually_verified: boolean
          last_name: string | null
          mileage_charge: number
          name: string
          new_appointment_time: string | null
          notes: string | null
          payment_intent: string | null
          payment_method: string | null
          pending_address_verification: boolean | null
          pending_verification_date: string | null
          pending_verification_reason: string | null
          phone: string
          picked_up_at: string | null
          pickup_date: string
          pickup_time_slot: string | null
          plan: Json
          refund_details: Json | null
          rented_out_at: string | null
          reschedule_fee: number | null
          reschedule_history: Json[] | null
          reschedule_timestamp: string | null
          return_issues: Json | null
          returned_at: string | null
          state: string
          status: string | null
          street: string
          total_price: number
          unverified_address: string | null
          verification_notes: string | null
          was_verification_skipped: boolean | null
          zip: string
        }
        Insert: {
          addons: Json
          address_verified_by_admin?: string | null
          address_verified_date?: string | null
          assigned_inventory_items?: Json | null
          city: string
          client_secret?: string | null
          contact_address?: Json | null
          created_at?: string
          customer_id?: number | null
          damage_photos?: Json | null
          delivered_at?: string | null
          delivery_address?: Json | null
          distance_miles?: number
          drop_off_date: string
          drop_off_time_slot?: string | null
          email: string
          equipment_status?: string | null
          fees?: Json | null
          first_name?: string | null
          id?: never
          is_manually_verified?: boolean
          last_name?: string | null
          mileage_charge?: number
          name: string
          new_appointment_time?: string | null
          notes?: string | null
          payment_intent?: string | null
          payment_method?: string | null
          pending_address_verification?: boolean | null
          pending_verification_date?: string | null
          pending_verification_reason?: string | null
          phone: string
          picked_up_at?: string | null
          pickup_date: string
          pickup_time_slot?: string | null
          plan: Json
          refund_details?: Json | null
          rented_out_at?: string | null
          reschedule_fee?: number | null
          reschedule_history?: Json[] | null
          reschedule_timestamp?: string | null
          return_issues?: Json | null
          returned_at?: string | null
          state: string
          status?: string | null
          street: string
          total_price: number
          unverified_address?: string | null
          verification_notes?: string | null
          was_verification_skipped?: boolean | null
          zip: string
        }
        Update: {
          addons?: Json
          address_verified_by_admin?: string | null
          address_verified_date?: string | null
          assigned_inventory_items?: Json | null
          city?: string
          client_secret?: string | null
          contact_address?: Json | null
          created_at?: string
          customer_id?: number | null
          damage_photos?: Json | null
          delivered_at?: string | null
          delivery_address?: Json | null
          distance_miles?: number
          drop_off_date?: string
          drop_off_time_slot?: string | null
          email?: string
          equipment_status?: string | null
          fees?: Json | null
          first_name?: string | null
          id?: never
          is_manually_verified?: boolean
          last_name?: string | null
          mileage_charge?: number
          name?: string
          new_appointment_time?: string | null
          notes?: string | null
          payment_intent?: string | null
          payment_method?: string | null
          pending_address_verification?: boolean | null
          pending_verification_date?: string | null
          pending_verification_reason?: string | null
          phone?: string
          picked_up_at?: string | null
          pickup_date?: string
          pickup_time_slot?: string | null
          plan?: Json
          refund_details?: Json | null
          rented_out_at?: string | null
          reschedule_fee?: number | null
          reschedule_history?: Json[] | null
          reschedule_timestamp?: string | null
          return_issues?: Json | null
          returned_at?: string | null
          state?: string
          status?: string | null
          street?: string
          total_price?: number
          unverified_address?: string | null
          verification_notes?: string | null
          was_verification_skipped?: boolean | null
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      business_settings: {
        Row: {
          id: number
          landfill_address: string | null
          setting_key: string
          setting_value: Json
          updated_at: string | null
        }
        Insert: {
          id?: number
          landfill_address?: string | null
          setting_key: string
          setting_value: Json
          updated_at?: string | null
        }
        Update: {
          id?: number
          landfill_address?: string | null
          setting_key?: string
          setting_value?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          attachment_name: string | null
          attachment_url: string | null
          booking_id: number | null
          conversation_id: string
          created_at: string | null
          customer_id: number
          id: string
          is_read: boolean | null
          message_content: string | null
          sender_id: string | null
          sender_type: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_url?: string | null
          booking_id?: number | null
          conversation_id: string
          created_at?: string | null
          customer_id: number
          id?: string
          is_read?: boolean | null
          message_content?: string | null
          sender_id?: string | null
          sender_type: string
        }
        Update: {
          attachment_name?: string | null
          attachment_url?: string | null
          booking_id?: number | null
          conversation_id?: string
          created_at?: string | null
          customer_id?: number
          id?: string
          is_read?: boolean | null
          message_content?: string | null
          sender_id?: string | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          created_at: string | null
          email: string
          id: number
          message: string
          name: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: number
          message: string
          name: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: number
          message?: string
          name?: string
        }
        Relationships: []
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          discount_type: string
          discount_value: number
          expires_at: string | null
          id: number
          is_active: boolean
          service_ids: number[] | null
          usage_count: number
          usage_limit: number | null
        }
        Insert: {
          code: string
          created_at?: string
          discount_type: string
          discount_value: number
          expires_at?: string | null
          id?: number
          is_active?: boolean
          service_ids?: number[] | null
          usage_count?: number
          usage_limit?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          discount_type?: string
          discount_value?: number
          expires_at?: string | null
          id?: number
          is_active?: boolean
          service_ids?: number[] | null
          usage_count?: number
          usage_limit?: number | null
        }
        Relationships: []
      }
      customer_notes: {
        Row: {
          attachment_name: string | null
          attachment_url: string | null
          author_id: string | null
          author_type: string | null
          booking_id: number | null
          content: string
          created_at: string
          customer_id: number
          id: number
          is_read: boolean
          parent_note_id: number | null
          source: string
          thread_id: number | null
        }
        Insert: {
          attachment_name?: string | null
          attachment_url?: string | null
          author_id?: string | null
          author_type?: string | null
          booking_id?: number | null
          content: string
          created_at?: string
          customer_id: number
          id?: number
          is_read?: boolean
          parent_note_id?: number | null
          source: string
          thread_id?: number | null
        }
        Update: {
          attachment_name?: string | null
          attachment_url?: string | null
          author_id?: string | null
          author_type?: string | null
          booking_id?: number | null
          content?: string
          created_at?: string
          customer_id?: number
          id?: number
          is_read?: boolean
          parent_note_id?: number | null
          source?: string
          thread_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_notes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_parent_note_id_fkey"
            columns: ["parent_note_id"]
            isOneToOne: false
            referencedRelation: "customer_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "customer_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          admin_notes: string | null
          city: string | null
          created_at: string
          customer_id_text: string | null
          distance_miles: number | null
          email: string
          first_name: string | null
          has_incomplete_verification: boolean | null
          has_unread_notes: boolean
          id: number
          last_name: string | null
          license_image_urls: Json | null
          license_plate: string | null
          name: string
          notes: string | null
          phone: string | null
          state: string | null
          street: string | null
          stripe_charge_id: string | null
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          travel_time_minutes: number | null
          unverified_address: boolean | null
          user_id: string | null
          zip: string | null
        }
        Insert: {
          admin_notes?: string | null
          city?: string | null
          created_at?: string
          customer_id_text?: string | null
          distance_miles?: number | null
          email: string
          first_name?: string | null
          has_incomplete_verification?: boolean | null
          has_unread_notes?: boolean
          id?: number
          last_name?: string | null
          license_image_urls?: Json | null
          license_plate?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          street?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          travel_time_minutes?: number | null
          unverified_address?: boolean | null
          user_id?: string | null
          zip?: string | null
        }
        Update: {
          admin_notes?: string | null
          city?: string | null
          created_at?: string
          customer_id_text?: string | null
          distance_miles?: number | null
          email?: string
          first_name?: string | null
          has_incomplete_verification?: boolean | null
          has_unread_notes?: boolean
          id?: number
          last_name?: string | null
          license_image_urls?: Json | null
          license_plate?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          street?: string | null
          stripe_charge_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          travel_time_minutes?: number | null
          unverified_address?: boolean | null
          user_id?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      date_specific_availability: {
        Row: {
          date: string
          delivery_end_time: string | null
          delivery_pickup_end_time: string | null
          delivery_pickup_start_time: string | null
          delivery_start_time: string | null
          id: number
          is_available: boolean
          pickup_start_time: string | null
          return_by_time: string | null
          service_id: number
        }
        Insert: {
          date: string
          delivery_end_time?: string | null
          delivery_pickup_end_time?: string | null
          delivery_pickup_start_time?: string | null
          delivery_start_time?: string | null
          id?: number
          is_available?: boolean
          pickup_start_time?: string | null
          return_by_time?: string | null
          service_id: number
        }
        Update: {
          date?: string
          delivery_end_time?: string | null
          delivery_pickup_end_time?: string | null
          delivery_pickup_start_time?: string | null
          delivery_start_time?: string | null
          id?: number
          is_available?: boolean
          pickup_start_time?: string | null
          return_by_time?: string | null
          service_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "date_specific_availability_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_verification_documents: {
        Row: {
          customer_id: number | null
          id: string
          license_back_storage_path: string | null
          license_back_url: string | null
          license_front_storage_path: string | null
          license_front_url: string | null
          uploaded_at: string | null
          verification_status: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          customer_id?: number | null
          id?: string
          license_back_storage_path?: string | null
          license_back_url?: string | null
          license_front_storage_path?: string | null
          license_front_url?: string | null
          uploaded_at?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          customer_id?: number | null
          id?: string
          license_back_storage_path?: string | null
          license_back_url?: string | null
          license_front_storage_path?: string | null
          license_front_url?: string | null
          uploaded_at?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_verification_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      dump_fees: {
        Row: {
          created_at: string | null
          delivery_fee: number | null
          fee_per_ton: number
          id: number
          max_tons: number | null
          service_id: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          delivery_fee?: number | null
          fee_per_ton?: number
          id?: number
          max_tons?: number | null
          service_id?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          delivery_fee?: number | null
          fee_per_ton?: number
          id?: number
          max_tons?: number | null
          service_id?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dump_fees_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: true
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      email_verifications: {
        Row: {
          attempts: number | null
          code_expires_at: string
          created_at: string | null
          email: string
          is_verified: boolean | null
          verification_code: string
        }
        Insert: {
          attempts?: number | null
          code_expires_at: string
          created_at?: string | null
          email: string
          is_verified?: boolean | null
          verification_code: string
        }
        Update: {
          attempts?: number | null
          code_expires_at?: string
          created_at?: string | null
          email?: string
          is_verified?: boolean | null
          verification_code?: string
        }
        Relationships: []
      }
      equipment: {
        Row: {
          blocks_all_services_when_rented: boolean | null
          created_at: string
          description: string | null
          id: number
          name: string
          price: number | null
          service_id_association: number | null
          total_quantity: number
          type: string | null
        }
        Insert: {
          blocks_all_services_when_rented?: boolean | null
          created_at?: string
          description?: string | null
          id?: never
          name: string
          price?: number | null
          service_id_association?: number | null
          total_quantity?: number
          type?: string | null
        }
        Update: {
          blocks_all_services_when_rented?: boolean | null
          created_at?: string
          description?: string | null
          id?: never
          name?: string
          price?: number | null
          service_id_association?: number | null
          total_quantity?: number
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_service_id_association_fkey"
            columns: ["service_id_association"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_inventory: {
        Row: {
          condition: string
          created_at: string
          current_value: number
          depreciation_rate: number
          equipment_type: string
          id: number
          name: string
          purchase_date: string
          purchase_price: number
          status: string
          updated_at: string
        }
        Insert: {
          condition: string
          created_at?: string
          current_value: number
          depreciation_rate?: number
          equipment_type: string
          id?: number
          name: string
          purchase_date: string
          purchase_price: number
          status?: string
          updated_at?: string
        }
        Update: {
          condition?: string
          created_at?: string
          current_value?: number
          depreciation_rate?: number
          equipment_type?: string
          id?: number
          name?: string
          purchase_date?: string
          purchase_price?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      equipment_pricing: {
        Row: {
          base_price: number
          created_at: string | null
          equipment_id: number
          id: string
          item_type: string
          last_updated: string | null
          price_history: Json | null
          updated_by: string | null
        }
        Insert: {
          base_price: number
          created_at?: string | null
          equipment_id: number
          id?: string
          item_type: string
          last_updated?: string | null
          price_history?: Json | null
          updated_by?: string | null
        }
        Update: {
          base_price?: number
          created_at?: string | null
          equipment_id?: number
          id?: string
          item_type?: string
          last_updated?: string | null
          price_history?: Json | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_equipment_pricing_equipment"
            columns: ["equipment_id"]
            isOneToOne: true
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      faqs: {
        Row: {
          answer: string
          created_at: string
          id: number
          position: number | null
          question: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: number
          position?: number | null
          question: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: number
          position?: number | null
          question?: string
        }
        Relationships: []
      }
      financial_audit_log: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          id: number
          record_id: number
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          id?: number
          record_id: number
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          id?: number
          record_id?: number
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      financial_categories: {
        Row: {
          category_type: string
          created_at: string
          description: string | null
          id: number
          is_custom: boolean
          name: string
          updated_at: string
        }
        Insert: {
          category_type: string
          created_at?: string
          description?: string | null
          id?: number
          is_custom?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          category_type?: string
          created_at?: string
          description?: string | null
          id?: number
          is_custom?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      financial_expenses: {
        Row: {
          amount: number
          category_id: number | null
          created_at: string
          created_by: string | null
          date: string
          description: string | null
          equipment_id: number | null
          id: number
          mileage: number | null
          updated_at: string
          vendor: string | null
        }
        Insert: {
          amount: number
          category_id?: number | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string | null
          equipment_id?: number | null
          id?: number
          mileage?: number | null
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          amount?: number
          category_id?: number | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string | null
          equipment_id?: number | null
          id?: number
          mileage?: number | null
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_expenses_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_income: {
        Row: {
          amount: number
          booking_id: number | null
          created_at: string
          created_by: string | null
          customer_id: number | null
          date: string
          description: string | null
          id: number
          income_type: string
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id?: number | null
          created_at?: string
          created_by?: string | null
          customer_id?: number | null
          date?: string
          description?: string | null
          id?: number
          income_type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: number | null
          created_at?: string
          created_by?: string | null
          customer_id?: number | null
          date?: string
          description?: string | null
          id?: number
          income_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_income_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_income_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_projections: {
        Row: {
          confidence_level: number | null
          created_at: string
          data: Json
          end_date: string
          id: number
          projection_type: string
          start_date: string
          updated_at: string
        }
        Insert: {
          confidence_level?: number | null
          created_at?: string
          data: Json
          end_date: string
          id?: number
          projection_type: string
          start_date: string
          updated_at?: string
        }
        Update: {
          confidence_level?: number | null
          created_at?: string
          data?: Json
          end_date?: string
          id?: number
          projection_type?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      financial_reports: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          date_range_end: string
          date_range_start: string
          id: number
          report_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          date_range_end: string
          date_range_start: string
          id?: number
          report_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          date_range_end?: string
          date_range_start?: string
          id?: number
          report_type?: string
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          created_at: string
          id: number
          name: string
          total_quantity: number
          type: string
        }
        Insert: {
          created_at?: string
          id?: number
          name: string
          total_quantity: number
          type: string
        }
        Update: {
          created_at?: string
          id?: number
          name?: string
          total_quantity?: number
          type?: string
        }
        Relationships: []
      }
      inventory_rules: {
        Row: {
          id: number
          inventory_item_id: number
          quantity_required: number
          service_id: number
        }
        Insert: {
          id?: number
          inventory_item_id: number
          quantity_required?: number
          service_id: number
        }
        Update: {
          id?: number
          inventory_item_id?: number
          quantity_required?: number
          service_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_rules_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_rules_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_schedule: {
        Row: {
          category_id: number
          created_at: string
          equipment_id: number
          frequency: string | null
          id: number
          last_service_date: string | null
          next_due_date: string | null
          updated_at: string
        }
        Insert: {
          category_id: number
          created_at?: string
          equipment_id: number
          frequency?: string | null
          id?: number
          last_service_date?: string | null
          next_due_date?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: number
          created_at?: string
          equipment_id?: number
          frequency?: string | null
          id?: number
          last_service_date?: string | null
          next_due_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_schedule_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_schedule_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      reschedule_history_logs: {
        Row: {
          admin_id: string | null
          approval_timestamp: string | null
          booking_id: number | null
          cancellation_reason: string | null
          created_at: string | null
          fee_amount: number | null
          fee_applied: boolean | null
          id: string
          new_appointment_time: string | null
          new_drop_off_date: string | null
          new_drop_off_time: string | null
          new_pickup_date: string | null
          new_pickup_time: string | null
          new_service_id: number | null
          new_total: number | null
          original_appointment_time: string | null
          original_drop_off_date: string | null
          original_drop_off_time: string | null
          original_pickup_date: string | null
          original_pickup_time: string | null
          original_service_id: number | null
          original_total: number | null
          refund_amount: number | null
          request_status: string | null
          request_type: string | null
          reschedule_request_time: string | null
          transaction_id: string | null
        }
        Insert: {
          admin_id?: string | null
          approval_timestamp?: string | null
          booking_id?: number | null
          cancellation_reason?: string | null
          created_at?: string | null
          fee_amount?: number | null
          fee_applied?: boolean | null
          id?: string
          new_appointment_time?: string | null
          new_drop_off_date?: string | null
          new_drop_off_time?: string | null
          new_pickup_date?: string | null
          new_pickup_time?: string | null
          new_service_id?: number | null
          new_total?: number | null
          original_appointment_time?: string | null
          original_drop_off_date?: string | null
          original_drop_off_time?: string | null
          original_pickup_date?: string | null
          original_pickup_time?: string | null
          original_service_id?: number | null
          original_total?: number | null
          refund_amount?: number | null
          request_status?: string | null
          request_type?: string | null
          reschedule_request_time?: string | null
          transaction_id?: string | null
        }
        Update: {
          admin_id?: string | null
          approval_timestamp?: string | null
          booking_id?: number | null
          cancellation_reason?: string | null
          created_at?: string | null
          fee_amount?: number | null
          fee_applied?: boolean | null
          id?: string
          new_appointment_time?: string | null
          new_drop_off_date?: string | null
          new_drop_off_time?: string | null
          new_pickup_date?: string | null
          new_pickup_time?: string | null
          new_service_id?: number | null
          new_total?: number | null
          original_appointment_time?: string | null
          original_drop_off_date?: string | null
          original_drop_off_time?: string | null
          original_pickup_date?: string | null
          original_pickup_time?: string | null
          original_service_id?: number | null
          original_total?: number | null
          refund_amount?: number | null
          request_status?: string | null
          request_type?: string | null
          reschedule_request_time?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reschedule_history_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_access_logs: {
        Row: {
          accessed_at: string | null
          customer_id: string | null
          id: string
          resource_id: string
        }
        Insert: {
          accessed_at?: string | null
          customer_id?: string | null
          id?: string
          resource_id: string
        }
        Update: {
          accessed_at?: string | null
          customer_id?: string | null
          id?: string
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_access_logs_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          category: string
          cover_image_url: string | null
          created_at: string
          description: string | null
          file_url: string | null
          id: string
          pdf_url: string | null
          qr_code_data: string | null
          qr_code_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          file_url?: string | null
          id?: string
          pdf_url?: string | null
          qr_code_data?: string | null
          qr_code_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          file_url?: string | null
          id?: string
          pdf_url?: string | null
          qr_code_data?: string | null
          qr_code_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          booking_id: number
          content: string
          created_at: string
          customer_id: number
          id: number
          image_urls: Json | null
          is_public: boolean
          rating: number
          title: string | null
        }
        Insert: {
          booking_id: number
          content: string
          created_at?: string
          customer_id: number
          id?: number
          image_urls?: Json | null
          is_public?: boolean
          rating: number
          title?: string | null
        }
        Update: {
          booking_id?: number
          content?: string
          created_at?: string
          customer_id?: number
          id?: number
          image_urls?: Json | null
          is_public?: boolean
          rating?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_booking"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_customer"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      service_availability: {
        Row: {
          created_at: string
          day_of_week: number
          delivery_pickup_window_end_time: string | null
          delivery_pickup_window_start_time: string | null
          delivery_window_end_time: string | null
          delivery_window_start_time: string | null
          id: number
          is_available: boolean
          pickup_end_time: string | null
          pickup_start_time: string | null
          return_by_time: string | null
          return_end_time: string | null
          service_id: number
          time_type: Database["public"]["Enums"]["service_time_type"] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          delivery_pickup_window_end_time?: string | null
          delivery_pickup_window_start_time?: string | null
          delivery_window_end_time?: string | null
          delivery_window_start_time?: string | null
          id?: number
          is_available?: boolean
          pickup_end_time?: string | null
          pickup_start_time?: string | null
          return_by_time?: string | null
          return_end_time?: string | null
          service_id: number
          time_type?: Database["public"]["Enums"]["service_time_type"] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          delivery_pickup_window_end_time?: string | null
          delivery_pickup_window_start_time?: string | null
          delivery_window_end_time?: string | null
          delivery_window_start_time?: string | null
          id?: number
          is_available?: boolean
          pickup_end_time?: string | null
          pickup_start_time?: string | null
          return_by_time?: string | null
          return_end_time?: string | null
          service_id?: number
          time_type?: Database["public"]["Enums"]["service_time_type"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_availability_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_reminders: {
        Row: {
          created_at: string
          due_date: string
          equipment_id: number | null
          id: number
          notes: string | null
          reminder_type: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_date: string
          equipment_id?: number | null
          id?: number
          notes?: string | null
          reminder_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          due_date?: string
          equipment_id?: number | null
          id?: number
          notes?: string | null
          reminder_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_reminders_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          base_price: number
          daily_rate: number | null
          delivery_fee: number | null
          description: string | null
          features: Json | null
          homepage_description: string | null
          homepage_price: number | null
          homepage_price_unit: string | null
          id: number
          mileage_rate: number | null
          name: string
          occupancy_model: Database["public"]["Enums"]["service_occupancy_model"]
          price_unit: string | null
          sale_price: number | null
          service_type:
            | Database["public"]["Enums"]["availability_time_type"]
            | null
          weekly_rate: number | null
        }
        Insert: {
          base_price?: number
          daily_rate?: number | null
          delivery_fee?: number | null
          description?: string | null
          features?: Json | null
          homepage_description?: string | null
          homepage_price?: number | null
          homepage_price_unit?: string | null
          id: number
          mileage_rate?: number | null
          name: string
          occupancy_model?: Database["public"]["Enums"]["service_occupancy_model"]
          price_unit?: string | null
          sale_price?: number | null
          service_type?:
            | Database["public"]["Enums"]["availability_time_type"]
            | null
          weekly_rate?: number | null
        }
        Update: {
          base_price?: number
          daily_rate?: number | null
          delivery_fee?: number | null
          description?: string | null
          features?: Json | null
          homepage_description?: string | null
          homepage_price?: number | null
          homepage_price_unit?: string | null
          id?: number
          mileage_rate?: number | null
          name?: string
          occupancy_model?: Database["public"]["Enums"]["service_occupancy_model"]
          price_unit?: string | null
          sale_price?: number | null
          service_type?:
            | Database["public"]["Enums"]["availability_time_type"]
            | null
          weekly_rate?: number | null
        }
        Relationships: []
      }
      stripe_payment_info: {
        Row: {
          booking_id: number
          created_at: string
          id: number
          stripe_charge_id: string | null
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          booking_id: number
          created_at?: string
          id?: number
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: number
          created_at?: string
          id?: number
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_payment_info_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      typing_indicators: {
        Row: {
          admin_is_typing: boolean | null
          conversation_id: string
          customer_is_typing: boolean | null
          id: string
          updated_at: string | null
        }
        Insert: {
          admin_is_typing?: boolean | null
          conversation_id: string
          customer_is_typing?: boolean | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          admin_is_typing?: boolean | null
          conversation_id?: string
          customer_is_typing?: boolean | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          role: string
          user_id: string
        }
        Insert: {
          role: string
          user_id: string
        }
        Update: {
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      verification_image_history: {
        Row: {
          action: string
          created_at: string | null
          customer_id: number | null
          document_id: string | null
          id: string
          image_type: string
          notes: string | null
          storage_path: string | null
          uploaded_by: string | null
          url: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          customer_id?: number | null
          document_id?: string | null
          id?: string
          image_type: string
          notes?: string | null
          storage_path?: string | null
          uploaded_by?: string | null
          url?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          customer_id?: number | null
          document_id?: string | null
          id?: string
          image_type?: string
          notes?: string | null
          storage_path?: string | null
          uploaded_by?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_image_history_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_image_history_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "driver_verification_documents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_pending_booking: { Args: { payload: Json }; Returns: Json }
      current_customer_id: { Args: never; Returns: number }
      decrement_equipment_quantities: {
        Args: { items_to_decrement: Json }
        Returns: undefined
      }
      handle_contact_form: {
        Args: {
          contact_email: string
          contact_message: string
          contact_name: string
        }
        Returns: undefined
      }
      increment_equipment_quantities: {
        Args: { items_to_increment: Json }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      server_insert_booking: {
        Args: { p_payload: Json; p_user_id: string }
        Returns: number
      }
      validate_coupon: {
        Args: { coupon_code: string; service_id_arg: number }
        Returns: Json
      }
    }
    Enums: {
      availability_time_type: "window" | "hourly"
      service_occupancy_model:
        | "range"
        | "dropoff_only"
        | "dropoff_and_pickup_only"
        | "same_day"
      service_time_type: "window" | "fullday" | "hourly"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      availability_time_type: ["window", "hourly"],
      service_occupancy_model: [
        "range",
        "dropoff_only",
        "dropoff_and_pickup_only",
        "same_day",
      ],
      service_time_type: ["window", "fullday", "hourly"],
    },
  },
} as const
