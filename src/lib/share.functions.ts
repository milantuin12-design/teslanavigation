import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getD1 } from "./d1.server";

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
  payload: Record<string, any>;
};

/** Publieke lezing van een gedeelde route, uitsluitend met een geldig deel-token. */
export const getSharedRoute = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(8).max(120) }).parse(input))
  .handler(async ({ data }): Promise<SharedRoute | null> => {
    try {
      const row = await getD1().prepare(`
        SELECT name,start_address,end_address,start_lat,start_lng,end_lat,end_lng,
          model_name,battery_percent,total_distance_km,total_time_min,payload
        FROM saved_routes WHERE share_token = ? AND shared = 1 LIMIT 1
      `).bind(data.token).first<Record<string, unknown>>();
      if (!row) return null;
      let payload: Record<string, any> = {};
      if (typeof row.payload === "string") {
        try { payload = JSON.parse(row.payload) as Record<string, any>; } catch { payload = {}; }
      }
      return {
        name: String(row.name),
        startAddress: row.start_address as string | null,
        endAddress: row.end_address as string | null,
        startLat: Number(row.start_lat),
        startLng: Number(row.start_lng),
        endLat: Number(row.end_lat),
        endLng: Number(row.end_lng),
        modelName: String(row.model_name),
        batteryPercent: Number(row.battery_percent),
        totalDistanceKm: row.total_distance_km == null ? null : Number(row.total_distance_km),
        totalTimeMin: row.total_time_min == null ? null : Number(row.total_time_min),
        payload,
      };
    } catch {
      return null;
    }
  });
