import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type SharedRoute = {
  name: string;
  startAddress: string | null;
  endAddress: string | null;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  modelName: string;
  batteryPercent: number;
  totalDistanceKm: number | null;
  totalTimeMin: number | null;
  payload: Record<string, unknown>;
};

/** Publieke lezing van een gedeelde route (alleen met geldig deel-token). */
export const getSharedRoute = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(8).max(120) }).parse(input))
  .handler(async ({ data }): Promise<SharedRoute | null> => {
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_ANON_KEY"];
    const url = process.env["SUPABASE_URL"];
    if (!key || !url) return null;
    try {
      const client = createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) => {
            const h = new Headers(init?.headers);
            if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
            h.set("apikey", key);
            return fetch(input, { ...init, headers: h });
          },
        },
      });
      const { data: row, error } = await client
        .from("saved_routes")
        .select(
          "name,start_address,end_address,start_lat,start_lng,end_lat,end_lng,model_name,battery_percent,total_distance_km,total_time_min,payload",
        )
        .eq("share_token", data.token)
        .eq("shared", true)
        .maybeSingle();
      if (error || !row) return null;
      return {
        name: row.name,
        startAddress: row.start_address,
        endAddress: row.end_address,
        startLat: row.start_lat,
        startLng: row.start_lng,
        endLat: row.end_lat,
        endLng: row.end_lng,
        modelName: row.model_name,
        batteryPercent: row.battery_percent,
        totalDistanceKm: row.total_distance_km,
        totalTimeMin: row.total_time_min,
        payload: (row.payload as Record<string, unknown>) ?? {},
      };
    } catch {
      return null;
    }
  });
