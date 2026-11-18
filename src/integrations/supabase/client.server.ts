// Legacy import path retained so existing server functions can be migrated safely.
// All server-side database operations now go to Cloudflare D1.
import { createD1SupabaseClient } from "@/lib/d1-supabase-adapter.server";

export const supabaseAdmin = createD1SupabaseClient();
