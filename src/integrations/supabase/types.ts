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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      charger_reports: {
        Row: {
          admin_note: string | null
          category: string
          charger_id: string | null
          charger_name: string | null
          contact_email: string | null
          created_at: string
          id: string
          message: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_note?: string | null
          category?: string
          charger_id?: string | null
          charger_name?: string | null
          contact_email?: string | null
          created_at?: string
          id?: string
          message: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_note?: string | null
          category?: string
          charger_id?: string | null
          charger_name?: string | null
          contact_email?: string | null
          created_at?: string
          id?: string
          message?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charger_reports_charger_id_fkey"
            columns: ["charger_id"]
            isOneToOne: false
            referencedRelation: "superchargers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          blocked: boolean
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          last_active_at: string | null
          route_count: number
          updated_at: string
        }
        Insert: {
          blocked?: boolean
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          last_active_at?: string | null
          route_count?: number
          updated_at?: string
        }
        Update: {
          blocked?: boolean
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          last_active_at?: string | null
          route_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      saved_routes: {
        Row: {
          battery_percent: number
          charger_ids: string[]
          created_at: string
          end_address: string | null
          end_lat: number
          end_lng: number
          id: string
          model_name: string
          name: string
          route_type: string
          start_address: string | null
          start_lat: number
          start_lng: number
          time_mode: string
          total_distance_km: number | null
          total_time_min: number | null
          trailer_mode: boolean
          trailer_reduction: number
          updated_at: string
          user_id: string
          weather_mode: string
        }
        Insert: {
          battery_percent: number
          charger_ids?: string[]
          created_at?: string
          end_address?: string | null
          end_lat: number
          end_lng: number
          id?: string
          model_name: string
          name: string
          route_type?: string
          start_address?: string | null
          start_lat: number
          start_lng: number
          time_mode?: string
          total_distance_km?: number | null
          total_time_min?: number | null
          trailer_mode?: boolean
          trailer_reduction?: number
          updated_at?: string
          user_id: string
          weather_mode?: string
        }
        Update: {
          battery_percent?: number
          charger_ids?: string[]
          created_at?: string
          end_address?: string | null
          end_lat?: number
          end_lng?: number
          id?: string
          model_name?: string
          name?: string
          route_type?: string
          start_address?: string | null
          start_lat?: number
          start_lng?: number
          time_mode?: string
          total_distance_km?: number | null
          total_time_min?: number | null
          trailer_mode?: boolean
          trailer_reduction?: number
          updated_at?: string
          user_id?: string
          weather_mode?: string
        }
        Relationships: []
      }
      superchargers: {
        Row: {
          charger_configs: Json
          city: string | null
          closing_time: string | null
          closure: Json
          construction: Json
          country: string
          id: string
          in_parking_garage: boolean
          is_available: boolean
          last_updated: string | null
          lat: number
          lng: number
          max_speed_kw: number | null
          name: string
          occupied_stalls: number | null
          opening_hours: Json
          opening_time: string | null
          parking_fee: boolean
          province: string | null
          stall_types: string | null
          status: string
          total_stalls: number | null
          trailer_friendly: boolean
          updated_at: string
          versions: string[] | null
          works: Json
        }
        Insert: {
          charger_configs?: Json
          city?: string | null
          closing_time?: string | null
          closure?: Json
          construction?: Json
          country: string
          id?: string
          in_parking_garage?: boolean
          is_available?: boolean
          last_updated?: string | null
          lat: number
          lng: number
          max_speed_kw?: number | null
          name: string
          occupied_stalls?: number | null
          opening_hours?: Json
          opening_time?: string | null
          parking_fee?: boolean
          province?: string | null
          stall_types?: string | null
          status?: string
          total_stalls?: number | null
          trailer_friendly?: boolean
          updated_at?: string
          versions?: string[] | null
          works?: Json
        }
        Update: {
          charger_configs?: Json
          city?: string | null
          closing_time?: string | null
          closure?: Json
          construction?: Json
          country?: string
          id?: string
          in_parking_garage?: boolean
          is_available?: boolean
          last_updated?: string | null
          lat?: number
          lng?: number
          max_speed_kw?: number | null
          name?: string
          occupied_stalls?: number | null
          opening_hours?: Json
          opening_time?: string | null
          parking_fee?: boolean
          province?: string | null
          stall_types?: string | null
          status?: string
          total_stalls?: number | null
          trailer_friendly?: boolean
          updated_at?: string
          versions?: string[] | null
          works?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
